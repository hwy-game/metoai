// 静态打包的 catalog 聚合（见 ADR-0031）。main 与 renderer 都顶层 import 本文件，
// 由各自 Vite bundle 把 JSON 内联——零运行时 fs、零 async、不闪。新增语言/ns =
// 在此加一条 import + 在 resources 里加一项。

import enAbilities from "./locales/en/abilities.json";
import enAgentTeams from "./locales/en/agent-teams.json";
import enAutomation from "./locales/en/automation.json";
import enBatchTasks from "./locales/en/batch-tasks.json";
import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enMain from "./locales/en/main.json";
import enMessage from "./locales/en/message.json";
import enMetoai from "./locales/en/metoai.json";
import enPet from "./locales/en/pet.json";
import enProject from "./locales/en/project.json";
import enSettings from "./locales/en/settings.json";
import enSkills from "./locales/en/skills.json";
import esAbilities from "./locales/es/abilities.json";
import esAgentTeams from "./locales/es/agent-teams.json";
import esAutomation from "./locales/es/automation.json";
import esBatchTasks from "./locales/es/batch-tasks.json";
import esChat from "./locales/es/chat.json";
import esCommon from "./locales/es/common.json";
import esMain from "./locales/es/main.json";
import esMessage from "./locales/es/message.json";
import esMetoai from "./locales/es/metoai.json";
import esPet from "./locales/es/pet.json";
import esProject from "./locales/es/project.json";
import esSettings from "./locales/es/settings.json";
import esSkills from "./locales/es/skills.json";
import frAbilities from "./locales/fr/abilities.json";
import frAgentTeams from "./locales/fr/agent-teams.json";
import frAutomation from "./locales/fr/automation.json";
import frBatchTasks from "./locales/fr/batch-tasks.json";
import frChat from "./locales/fr/chat.json";
import frCommon from "./locales/fr/common.json";
import frMain from "./locales/fr/main.json";
import frMessage from "./locales/fr/message.json";
import frMetoai from "./locales/fr/metoai.json";
import frPet from "./locales/fr/pet.json";
import frProject from "./locales/fr/project.json";
import frSettings from "./locales/fr/settings.json";
import frSkills from "./locales/fr/skills.json";
import idAbilities from "./locales/id/abilities.json";
import idAgentTeams from "./locales/id/agent-teams.json";
import idAutomation from "./locales/id/automation.json";
import idBatchTasks from "./locales/id/batch-tasks.json";
import idChat from "./locales/id/chat.json";
import idCommon from "./locales/id/common.json";
import idMain from "./locales/id/main.json";
import idMessage from "./locales/id/message.json";
import idMetoai from "./locales/id/metoai.json";
import idPet from "./locales/id/pet.json";
import idProject from "./locales/id/project.json";
import idSettings from "./locales/id/settings.json";
import idSkills from "./locales/id/skills.json";
import jaAbilities from "./locales/ja/abilities.json";
import jaAgentTeams from "./locales/ja/agent-teams.json";
import jaAutomation from "./locales/ja/automation.json";
import jaBatchTasks from "./locales/ja/batch-tasks.json";
import jaChat from "./locales/ja/chat.json";
import jaCommon from "./locales/ja/common.json";
import jaMain from "./locales/ja/main.json";
import jaMessage from "./locales/ja/message.json";
import jaMetoai from "./locales/ja/metoai.json";
import jaPet from "./locales/ja/pet.json";
import jaProject from "./locales/ja/project.json";
import jaSettings from "./locales/ja/settings.json";
import jaSkills from "./locales/ja/skills.json";
import ruAbilities from "./locales/ru/abilities.json";
import ruAgentTeams from "./locales/ru/agent-teams.json";
import ruAutomation from "./locales/ru/automation.json";
import ruBatchTasks from "./locales/ru/batch-tasks.json";
import ruChat from "./locales/ru/chat.json";
import ruCommon from "./locales/ru/common.json";
import ruMain from "./locales/ru/main.json";
import ruMessage from "./locales/ru/message.json";
import ruMetoai from "./locales/ru/metoai.json";
import ruPet from "./locales/ru/pet.json";
import ruProject from "./locales/ru/project.json";
import ruSettings from "./locales/ru/settings.json";
import ruSkills from "./locales/ru/skills.json";
import viAbilities from "./locales/vi/abilities.json";
import viAgentTeams from "./locales/vi/agent-teams.json";
import viAutomation from "./locales/vi/automation.json";
import viBatchTasks from "./locales/vi/batch-tasks.json";
import viChat from "./locales/vi/chat.json";
import viCommon from "./locales/vi/common.json";
import viMain from "./locales/vi/main.json";
import viMessage from "./locales/vi/message.json";
import viMetoai from "./locales/vi/metoai.json";
import viPet from "./locales/vi/pet.json";
import viProject from "./locales/vi/project.json";
import viSettings from "./locales/vi/settings.json";
import viSkills from "./locales/vi/skills.json";
import zhAbilities from "./locales/zh/abilities.json";
import zhAgentTeams from "./locales/zh/agent-teams.json";
import zhAutomation from "./locales/zh/automation.json";
import zhBatchTasks from "./locales/zh/batch-tasks.json";
import zhChat from "./locales/zh/chat.json";
import zhCommon from "./locales/zh/common.json";
import zhMain from "./locales/zh/main.json";
import zhMessage from "./locales/zh/message.json";
import zhMetoai from "./locales/zh/metoai.json";
import zhPet from "./locales/zh/pet.json";
import zhProject from "./locales/zh/project.json";
import zhSettings from "./locales/zh/settings.json";
import zhSkills from "./locales/zh/skills.json";

export const resources = {
	zh: {
		common: zhCommon,
		main: zhMain,
		chat: zhChat,
		project: zhProject,
		pet: zhPet,
		settings: zhSettings,
		message: zhMessage,
		skills: zhSkills,
		abilities: zhAbilities,
		"batch-tasks": zhBatchTasks,
		automation: zhAutomation,
		"agent-teams": zhAgentTeams,
		metoai: zhMetoai,
	},
	en: {
		common: enCommon,
		main: enMain,
		chat: enChat,
		project: enProject,
		pet: enPet,
		settings: enSettings,
		message: enMessage,
		skills: enSkills,
		abilities: enAbilities,
		"batch-tasks": enBatchTasks,
		automation: enAutomation,
		"agent-teams": enAgentTeams,
		metoai: enMetoai,
	},
	es: {
		common: esCommon,
		main: esMain,
		chat: esChat,
		project: esProject,
		pet: esPet,
		settings: esSettings,
		message: esMessage,
		skills: esSkills,
		abilities: esAbilities,
		"batch-tasks": esBatchTasks,
		automation: esAutomation,
		"agent-teams": esAgentTeams,
		metoai: esMetoai,
	},
	fr: {
		common: frCommon,
		main: frMain,
		chat: frChat,
		project: frProject,
		pet: frPet,
		settings: frSettings,
		message: frMessage,
		skills: frSkills,
		abilities: frAbilities,
		"batch-tasks": frBatchTasks,
		automation: frAutomation,
		"agent-teams": frAgentTeams,
		metoai: frMetoai,
	},
	id: {
		common: idCommon,
		main: idMain,
		chat: idChat,
		project: idProject,
		pet: idPet,
		settings: idSettings,
		message: idMessage,
		skills: idSkills,
		abilities: idAbilities,
		"batch-tasks": idBatchTasks,
		automation: idAutomation,
		"agent-teams": idAgentTeams,
		metoai: idMetoai,
	},
	vi: {
		common: viCommon,
		main: viMain,
		chat: viChat,
		project: viProject,
		pet: viPet,
		settings: viSettings,
		message: viMessage,
		skills: viSkills,
		abilities: viAbilities,
		"batch-tasks": viBatchTasks,
		automation: viAutomation,
		"agent-teams": viAgentTeams,
		metoai: viMetoai,
	},
	ru: {
		common: ruCommon,
		main: ruMain,
		chat: ruChat,
		project: ruProject,
		pet: ruPet,
		settings: ruSettings,
		message: ruMessage,
		skills: ruSkills,
		abilities: ruAbilities,
		"batch-tasks": ruBatchTasks,
		automation: ruAutomation,
		"agent-teams": ruAgentTeams,
		metoai: ruMetoai,
	},
	ja: {
		common: jaCommon,
		main: jaMain,
		chat: jaChat,
		project: jaProject,
		pet: jaPet,
		settings: jaSettings,
		message: jaMessage,
		skills: jaSkills,
		abilities: jaAbilities,
		"batch-tasks": jaBatchTasks,
		automation: jaAutomation,
		"agent-teams": jaAgentTeams,
		metoai: jaMetoai,
	},
} as const;

export * from "./config.js";
