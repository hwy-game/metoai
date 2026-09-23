import { describe, expect, it } from "vitest";
import { normalizePetConfig } from "../../../shared/pet-config.js";
import { migratePetConfig } from "./migrate-config.js";

describe("桌宠配置迁移", () => {
	it("v4 存量配置迁移后关闭桌宠，其余字段原样保留", () => {
		const result = migratePetConfig({ schemaVersion: 4, enabled: true, size: 260, videoScale: 1.36 });

		expect(result.migrated).toBe(true);
		expect(result.config.schemaVersion).toBe(5);
		expect(result.config.enabled).toBe(false);
		expect(result.config.size).toBe(260);
		expect(result.config.videoScale).toBe(1.36);
	});

	it("更早版本的配置沿迁移链一路走到当前版本", () => {
		const result = migratePetConfig({ schemaVersion: 1, enabled: true });

		expect(result.config.schemaVersion).toBe(5);
		expect(result.config.enabled).toBe(false);
	});

	it("没有配置或配置不可解析时默认关闭桌宠", () => {
		expect(normalizePetConfig(undefined).enabled).toBe(false);
		expect(normalizePetConfig({}).enabled).toBe(false);
	});

	it("用户显式打开的桌宠在迁移之后仍是打开的", () => {
		const result = migratePetConfig({ schemaVersion: 4, enabled: true });
		// 迁移只把版本推进一步，之后用户再打开是普通写配置，不会被再次关掉。
		const reopened = normalizePetConfig({ ...result.config, enabled: true });

		expect(reopened.enabled).toBe(true);
	});
});
