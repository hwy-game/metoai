import { decideUpdatePolicy, type UpdatePolicy } from "./update-policy.js";

/**
 * 打包 E2E 用的策略替身。
 *
 * 版本检测、更新说明与是否强制只认 metotoken 的版本管理（见 docs/adr/0120），而 CI 里的
 * 打包产物指向真实站点，无法让它登记一个测试版本。没有策略，更新链路在 E2E 里永远走不到
 * `available`，Linux 的真实下载与安装准备、Windows/macOS 的「登记版本装不上时不许提示」
 * 就都失去了覆盖。
 *
 * 与 `configureE2eUpdateFeed`（updater.ts）同一道闸：只有带 E2E 标记的进程才会读到它，
 * 生产构建里启动环境无法改变更新判定；调用方另外要求 `app.isPackaged`。
 *
 * 内容是 `GET /api/desktop/update/check` 响应里 `data` 的形状，解析与收口完全复用
 * `decideUpdatePolicy`：非法 JSON 或形状不符一律当作「没有替身」，让调用方回落到真实请求。
 */
export function readE2eUpdatePolicy(env: NodeJS.ProcessEnv, currentVersion: string): UpdatePolicy | null {
	if (env.VETTA_E2E !== "1") return null;
	const raw = env.VETTA_E2E_UPDATE_POLICY?.trim();
	if (!raw) return null;

	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		console.warn("[update-policy] ignored an unparsable E2E policy override");
		return null;
	}

	const policy = decideUpdatePolicy(data, currentVersion);
	if (!policy) console.warn("[update-policy] ignored an unusable E2E policy override");
	return policy;
}
