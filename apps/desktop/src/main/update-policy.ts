import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

import { METOAI_API_BASE } from "../shared/metoai.js";

/**
 * 客户端向 metotoken 询问「这台机器该不该更新、能不能强制更新」的策略接口。
 *
 * 与能力市场（`renderer/shared/lib/api.ts` 的 `marketRequest`）同源同风格：请求**刻意
 * 不带任何凭据**，响应信封是 `{ code, message, data }`，`code !== 0` 视为失败。
 * 这条链路是安全阀：超时、网络错误、JSON 解析失败、schema 不合法一律返回 `null`，
 * 让调用方退回到 electron-updater 的默认行为，绝不抛错、绝不阻断启动。
 */

const UPDATE_CHECK_PATH = "/desktop/update/check";
const REQUEST_TIMEOUT_MS = 8_000;
/** 灰度分桶用的安装标识文件名（放在 vetta home 下，内容是裸 UUID）。 */
const INSTALL_ID_FILE_NAME = "metoai-install-id";

const DEFAULT_CHECK_INTERVAL_SECONDS = 7_200;
const MIN_CHECK_INTERVAL_SECONDS = 1_800;
const MAX_CHECK_INTERVAL_SECONDS = 86_400;

/**
 * 允许的更新包下载地址 host。与发布配置（`scripts/resolve-update-publish-config.mjs`）对齐：
 * commercial / cloud 构建强制 generic provider，产物发布在 releases.openvetta.com；
 * 开源构建走 github provider，release 资源会 302 到 objects.githubusercontent.com /
 * release-assets.githubusercontent.com。只用于客户端侧校验，不改 electron-updater 的 feed。
 */
const ALLOWED_DOWNLOAD_HOSTS: readonly string[] = [
	"releases.openvetta.com",
	"github.com",
	"objects.githubusercontent.com",
	"release-assets.githubusercontent.com",
];

/** 强制更新的触发原因：服务端策略主动要求，或当前版本已低于最低支持版本。 */
export type UpdatePolicyReason = "" | "policy" | "min_supported";

export interface UpdatePolicy {
	hasUpdate: boolean;
	forced: boolean;
	reason: UpdatePolicyReason;
	checkIntervalSeconds: number;
	latestVersion?: string;
	releaseNote?: string;
	downloadUrl?: string;
	sha256?: string;
	sizeBytes?: number;
	publishedAt?: string;
}

export interface UpdatePolicyInput {
	channel?: string;
	version: string;
	platform: string;
	arch: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `reason` 只接受三个取值：类型不对整份响应作废，取值未知则收敛为空。 */
function readReason(value: unknown): UpdatePolicyReason | null {
	if (typeof value !== "string") return null;
	return value === "policy" || value === "min_supported" ? value : "";
}

function parseVersion(value: string): { parts: number[]; prerelease: string[] } {
	const trimmed = value.trim().replace(/^v/i, "");
	const [withoutBuild = ""] = trimmed.split("+");
	const [release = "", ...prereleaseSegments] = withoutBuild.split("-");
	const parts = release.split(".").map((segment) => {
		const parsed = Number.parseInt(segment, 10);
		return Number.isFinite(parsed) ? parsed : 0;
	});
	const prerelease = prereleaseSegments
		.join("-")
		.split(".")
		.filter((segment) => segment !== "");
	return { parts, prerelease };
}

/**
 * 宽松语义化版本比较：容忍 `v` 前缀、缺失段（按 0）与多余段，按 semver 处理 prerelease
 * 与 build metadata —— 同号预发布版低于正式版，预发布标识按「数字段低于字母段」排序。
 * 只用于判断「是否更高」与「是否低于最低支持版本」，不引入任何依赖。
 */
export function compareVersions(left: string, right: string): number {
	const a = parseVersion(left);
	const b = parseVersion(right);
	const length = Math.max(a.parts.length, b.parts.length);
	for (let index = 0; index < length; index += 1) {
		const x = a.parts[index] ?? 0;
		const y = b.parts[index] ?? 0;
		if (x !== y) return x < y ? -1 : 1;
	}

	if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
	if (a.prerelease.length === 0) return 1;
	if (b.prerelease.length === 0) return -1;

	const prereleaseLength = Math.max(a.prerelease.length, b.prerelease.length);
	for (let index = 0; index < prereleaseLength; index += 1) {
		const x = a.prerelease[index];
		const y = b.prerelease[index];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const xNumber = /^\d+$/.test(x) ? Number.parseInt(x, 10) : null;
		const yNumber = /^\d+$/.test(y) ? Number.parseInt(y, 10) : null;
		if (xNumber !== null && yNumber !== null) {
			if (xNumber !== yNumber) return xNumber < yNumber ? -1 : 1;
			continue;
		}
		if (xNumber !== null) return -1;
		if (yNumber !== null) return 1;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

/**
 * 更新包下载地址必须是 https，且 host 落在发布白名单内。
 * 白名单之外的地址一律视为不可用（`decideUpdatePolicy` 会直接丢弃该字段）。
 */
export function isAllowedDownloadUrl(rawUrl: unknown): boolean {
	if (typeof rawUrl !== "string") return false;
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		return false;
	}
	return parsed.protocol === "https:" && ALLOWED_DOWNLOAD_HOSTS.includes(parsed.hostname);
}

/**
 * 把服务端建议的检查间隔夹取到 [1800, 86400]（30 分钟 ~ 24 小时）。
 * 非法值（非数字 / 非有限数 / <= 0）回落默认 7200；过小/过大按边界夹取。
 * 夹取保证服务端下发的间隔不会把客户端变成高频轮询。
 */
export function clampCheckInterval(seconds: unknown): number {
	if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
		return DEFAULT_CHECK_INTERVAL_SECONDS;
	}
	return Math.min(MAX_CHECK_INTERVAL_SECONDS, Math.max(MIN_CHECK_INTERVAL_SECONDS, Math.round(seconds)));
}

/**
 * 纯函数判定：把服务端 `data`（嵌套形状，见下）与当前版本合成为一份更新策略。
 *
 * ```
 * data = {
 *   has_update: boolean,
 *   forced: boolean,
 *   reason: "" | "policy" | "min_supported",
 *   check_interval_seconds: number,
 *   latest: null | { version, release_note, download_url, sha256, size_bytes, published_at, ... }
 * }
 * ```
 *
 * 解析规则：
 * - `latest === null` → 无更新、不强制，但仍要取到 `check_interval_seconds`；
 * - `forced` 取服务端结论（服务端已综合 policy 与 min_supported_version），客户端不重新推导；
 * - 安全护栏：`forced === true` 却拿不到更高版本的更新包 → 响应不自洽 → 整体返回 `null`；
 * - 任何必需字段类型不符 → 返回 `null`（fail-open，退回原有行为）。
 */
export function decideUpdatePolicy(responseData: unknown, currentVersion: string): UpdatePolicy | null {
	if (!isRecord(responseData)) return null;

	const hasUpdate = responseData.has_update;
	const forced = responseData.forced;
	const checkIntervalSeconds = readNumber(responseData.check_interval_seconds);
	const reason = readReason(responseData.reason);
	if (typeof hasUpdate !== "boolean" || typeof forced !== "boolean") return null;
	if (checkIntervalSeconds === undefined || reason === null) return null;

	const latest = responseData.latest;
	if (latest !== null && !isRecord(latest)) return null;

	if (latest === null) {
		// 服务端明确表示「没有可用的更新包」：此时不允许进入强制态，否则用户会被锁在
		// 一个根本下载不到更新的界面里。
		if (forced) return null;
		return {
			hasUpdate: false,
			forced: false,
			reason: "",
			checkIntervalSeconds: clampCheckInterval(checkIntervalSeconds),
		};
	}

	const latestVersion = readString(latest.version);
	if (latestVersion === undefined) return null;
	// 声称强制更新、却拿不到比当前版本更高的包，说明响应与客户端状态不符：整体放弃。
	if (forced && compareVersions(latestVersion, currentVersion) <= 0) return null;

	const downloadUrl = readString(latest.download_url);
	return {
		hasUpdate,
		forced,
		reason,
		checkIntervalSeconds: clampCheckInterval(checkIntervalSeconds),
		latestVersion,
		releaseNote: readString(latest.release_note),
		downloadUrl: isAllowedDownloadUrl(downloadUrl) ? downloadUrl : undefined,
		sha256: readString(latest.sha256),
		sizeBytes: readNumber(latest.size_bytes),
		publishedAt: readString(latest.published_at),
	};
}

/** `process.platform` → 服务端约定的平台名。未知平台原样返回，交由服务端处理。 */
export function resolveUpdatePlatform(platform: string): string {
	if (platform === "win32") return "windows";
	if (platform === "darwin") return "macos";
	return platform;
}

let cachedInstallId: string | null = null;

/**
 * 灰度分桶用的安装标识：首次生成随机 UUID 后持久化到 vetta home，之后复用。
 * 只用于服务端分桶，不携带任何账号/用户身份信息；读或写失败时降级为
 * 「本次进程内随机」，不影响功能。
 */
export function readOrCreateInstallId(): string {
	if (cachedInstallId) return cachedInstallId;

	const path = join(getVettaHomePath(), INSTALL_ID_FILE_NAME);
	try {
		const existing = readFileSync(path, "utf8").trim();
		if (existing) {
			cachedInstallId = existing;
			return existing;
		}
	} catch {
		// 首次运行或读取失败：下面生成新的标识。
	}

	const created = randomUUID();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, created, "utf8");
	} catch (error) {
		console.warn("[update-policy] failed to persist install id; falling back to an in-process value", error);
	}
	cachedInstallId = created;
	return created;
}

/**
 * 询问更新策略。任何失败（超时 / 网络 / JSON / schema）都返回 `null` 并记 warn，
 * 绝不抛错——拿不到策略时客户端应完全按原有行为运行。
 *
 * `signal` 供调用方（或测试）取消这次请求；内部仍保留自己的 8s 超时，两者取先到者。
 */
export async function fetchUpdatePolicy(input: UpdatePolicyInput, signal?: AbortSignal): Promise<UpdatePolicy | null> {
	const base = METOAI_API_BASE.replace(/\/+$/, "");
	const url = new URL(`${base}${UPDATE_CHECK_PATH}`);
	url.searchParams.set("version", input.version);
	url.searchParams.set("platform", input.platform);
	url.searchParams.set("arch", input.arch);
	url.searchParams.set("install_id", readOrCreateInstallId());
	if (input.channel) url.searchParams.set("channel", input.channel);

	const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	let payload: unknown;
	try {
		// 与能力市场一致：刻意不带任何凭据，避免 Vetta 的 serverToken 泄漏到 metotoken。
		const response = await fetch(url, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
		});
		payload = await response.json();
	} catch (error) {
		console.warn("[update-policy] update check request failed", error);
		return null;
	}

	if (!isRecord(payload) || payload.code !== 0) {
		const code = isRecord(payload) ? payload.code : "invalid";
		console.warn(`[update-policy] update check rejected (code=${String(code)})`);
		return null;
	}

	return decideUpdatePolicy(payload.data, input.version);
}
