import { migrateVersionedConfig, type VersionedConfigMigrationResult } from "@vetta/toolkit/versioned-config";
import { PET_CONFIG_SCHEMA_VERSION } from "../../../shared/pet-config.js";
import { petConfigMigration001To2 } from "./migrations/001_to_2.js";
import { petConfigMigration002To3 } from "./migrations/002_to_3.js";
import { petConfigMigration003To4 } from "./migrations/003_to_4.js";
import { petConfigMigration004To5 } from "./migrations/004_to_5.js";

const PET_CONFIG_MIGRATIONS = [
	petConfigMigration001To2,
	petConfigMigration002To3,
	petConfigMigration003To4,
	petConfigMigration004To5,
] as const;

export function migratePetConfig(value: unknown): VersionedConfigMigrationResult {
	return migrateVersionedConfig(value, {
		currentVersion: PET_CONFIG_SCHEMA_VERSION,
		migrations: PET_CONFIG_MIGRATIONS,
	});
}
