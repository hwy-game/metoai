/**
 * 登录后把 MetaToken 接进模型配置：确保账号下有一把可用 Key，并把它写成
 * `models.json` 里的 MetaToken 预设服务商。
 *
 * 这是「登录即用」的关键一步：用户不需要自己去站点复制 Key 再粘回来。
 * 写盘走 `ModelSettingsService.replaceConfig`（与设置页同一条链路），因此凭据
 * 仍然进凭据库、模型注册表与 Agent 运行时都会被刷新。
 */

import { METOAI_BASE_URL, METOAI_DISPLAY_NAME, METOAI_ICON, METOAI_PRESET_ID } from "../../shared/metoai.js";
import type { MetoAiModelAccessResult } from "../../shared/metoai-types.js";
import { getAppLogger } from "../logger.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import type { ModelsConfig } from "../models/model-settings-service.js";
import { isInvalidKey } from "../models/presets/errors.js";
import { refreshPresetModels } from "../models/presets/sync.js";
import { createToken, listTokens, revealTokenKey } from "./account.js";
import { hasSession } from "./session.js";

const log = getAppLogger("metoai");

/** 自动签发令牌用的固定名，便于用户在站点上认出来。 */
const AUTO_TOKEN_NAME = "Vetta Desktop";

function failureFromPresetError(error: { code: string; detail?: string } | undefined): MetoAiModelAccessResult {
	if (!error) return { ok: false, created: false, reason: "unknown" };
	if (error.code === "empty-models") return { ok: false, created: false, reason: "empty-models" };
	if (error.code === "unknown-provider") return { ok: false, created: false, reason: "unknown-provider" };
	if (error.code === "network" || error.code === "timeout") {
		return { ok: false, created: false, reason: "network", detail: error.detail };
	}
	return { ok: false, created: false, reason: "unknown", detail: error.detail };
}

/**
 * 找一把可用的令牌并换取完整 key。优先复用启用中的令牌，没有才新建——
 * 每次登录都新建令牌会把用户的令牌列表堆满，站点还有数量上限。
 */
async function obtainTokenKey(): Promise<{ key: string; created: boolean } | null> {
	const page = await listTokens({ page: 1, pageSize: 100 });
	const enabled = (page.items ?? []).filter((token) => token.status === 1);
	for (const token of enabled) {
		const key = await revealTokenKey(token.id).catch((error) => {
			log.warn(`failed to reveal token ${token.id}: ${String(error)}`);
			return null;
		});
		if (key) return { key, created: false };
	}

	const created = await createToken({ name: AUTO_TOKEN_NAME, unlimited_quota: true, expired_time: -1 });
	if (!created.key) {
		log.warn("created a token but could not read back its key");
		return null;
	}
	return { key: created.key, created: true };
}

/**
 * 幂等入口：已配置且 key 仍可用时只刷新模型列表；key 失效或未配置时重新签发。
 *
 * 判定「key 仍可用」的方式是直接拉一次上游 `/models`：这是唯一能同时验证 key
 * 与拿到模型列表的动作，比额外发一个探测请求更省一次往返。
 *
 * 单飞：登录后台预热与界面显式调用会同时命中，不能让它们各签一把 Key。
 */
export function ensureModelAccess(): Promise<MetoAiModelAccessResult> {
	ensureInFlight ??= runEnsureModelAccess().finally(() => {
		ensureInFlight = null;
	});
	return ensureInFlight;
}

let ensureInFlight: Promise<MetoAiModelAccessResult> | null = null;

async function runEnsureModelAccess(): Promise<MetoAiModelAccessResult> {
	if (!hasSession()) return { ok: false, created: false, reason: "not-logged-in" };

	const service = getDesktopModelSettingsService();
	const current = await service.getConfig();
	const existingKey = current.providers[METOAI_PRESET_ID]?.apiKey?.trim();

	if (existingKey) {
		const probe = await refreshPresetModels(METOAI_PRESET_ID, existingKey);
		if (!probe.error && probe.models.length > 0) return { ok: true, created: false };
		if (!isInvalidKey(probe.error)) return failureFromPresetError(probe.error);
		log.info("stored MetaToken key is no longer accepted; issuing a new one");
	}

	const token = await obtainTokenKey();
	if (!token) return { ok: false, created: false, reason: "invalid-key" };

	const fetched = await refreshPresetModels(METOAI_PRESET_ID, token.key);
	if (fetched.error || fetched.models.length === 0) {
		return failureFromPresetError(fetched.error ?? { code: "empty-models" });
	}

	// 重新读一次：拉模型期间渲染层可能改过配置，不能拿旧快照整体覆盖。
	const latest = await service.getConfig();
	const next: ModelsConfig = {
		...latest,
		providers: {
			...latest.providers,
			[METOAI_PRESET_ID]: {
				...latest.providers[METOAI_PRESET_ID],
				source: "template",
				templateId: METOAI_PRESET_ID,
				displayName: METOAI_DISPLAY_NAME,
				icon: METOAI_ICON,
				api: "openai-completions",
				baseUrl: METOAI_BASE_URL,
				apiKey: token.key,
				models: fetched.models,
				modelsSyncedAt: new Date().toISOString(),
			},
		},
	};
	await service.replaceConfig(next);
	log.info(`MetaToken model access ready (createdToken=${token.created})`);
	return { ok: true, created: token.created };
}

/** 退出登录后模型配置保持不变：已签发的 Key 仍属于用户账号，删掉反而更意外。 */
