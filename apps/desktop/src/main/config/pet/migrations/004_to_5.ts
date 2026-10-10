import type { VersionedConfigMigration } from "@vetta/toolkit/versioned-config";

export const petConfigMigration004To5: VersionedConfigMigration = {
	fromVersion: 4,
	toVersion: 5,
	migrate(config) {
		// v4 的默认值是开启，存量配置里的 true 绝大多数只是当时默认值写下来的、不是用户选择，
		// 两者无法区分，所以这里统一关一次；用户仍可在设置里重新打开。
		return { ...config, enabled: false };
	},
};
