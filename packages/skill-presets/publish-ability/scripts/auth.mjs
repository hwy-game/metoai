/**
 * 登录态与接口地址，供 skill 内所有脚本共用。
 *
 * 单独成文件是因为 publish.mjs 与 categories.mjs 必须读同一份凭据、拼同一个前缀：
 * 复制两份的话，哪天客户端换了凭据落盘位置，就会出现「能查分类但传不上去」这种半死状态。
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_PREFIX = "/api/v1";

/**
 * 归一 baseUrl 为服务根（不含 API 前缀）。
 *
 * 必须容忍两种写法：桌面端注入的 VETTA_SERVER_URL 自带 /api/v1，手工设
 * VETTA_API_BASE_URL 的人通常只写到域名。不统一就会拼出 /api/v1/api/v1/... 而 404。
 */
export function normalizeBaseUrl(raw) {
	return raw.replace(/\/+$/, "").replace(/\/api\/v\d+$/, "");
}

export function apiUrl(baseUrl, path) {
	return `${normalizeBaseUrl(baseUrl)}${API_PREFIX}${path}`;
}

/**
 * 读取登录态。
 *
 * `~/.metoai/auth.json`（品牌改名前的 `~/.vetta/auth.json`）是客户端为外部进程下沉的
 * 凭据契约，登录、刷新、登出都会同步它。每次执行都重读，所以 token 轮换后脚本天然拿到新的。
 *
 * `VETTA_HOME` 没被带进来时（外部进程、旧宿主）按主目录名自己判一次：新目录下没有
 * `auth.json` 就回退旧目录，否则用户明明登录着也会被报「未登录」。
 */
export function loadCredentials() {
	const envToken = process.env.VETTA_API_TOKEN?.trim();
	const envBase = process.env.VETTA_API_BASE_URL?.trim() || process.env.VETTA_SERVER_URL?.trim();
	if (envToken && envBase) {
		return { baseUrl: normalizeBaseUrl(envBase), token: envToken };
	}

	const home = process.env.VETTA_HOME?.trim() || resolveHomeDir();
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(join(home, "auth.json"), "utf8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;

	const token = envToken || (typeof parsed.token === "string" ? parsed.token.trim() : "");
	const baseUrl = envBase || (typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() : "");
	if (!token || !baseUrl) return null;

	return { baseUrl: normalizeBaseUrl(baseUrl), token };
}

/** 品牌改名后的主目录，新目录里没有凭据时回退旧目录。 */
function resolveHomeDir() {
	const next = join(homedir(), ".metoai");
	if (existsSync(join(next, "auth.json"))) return next;
	const legacy = join(homedir(), ".vetta");
	return existsSync(join(legacy, "auth.json")) ? legacy : next;
}
