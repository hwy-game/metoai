import { useLocalizedAgentTeamDocument } from "@shared/agent-teams/agent-team-localization";
import type { MarketAbility } from "@shared/lib/api";
import type { AgentBlueprint, AgentTeamDocument } from "@vetta/agent-team";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useState } from "react";
import type { BlueprintDisplayPlugin } from "../lib/blueprint-display";
import type { AgentCapabilityOption } from "../lib/capability-options";
import { loadAgentTeamConfigurationResources } from "../services/load-agent-team-resources";

export interface AgentTeamResources {
	readonly document?: AgentTeamDocument;
	readonly setDocument: Dispatch<SetStateAction<AgentTeamDocument | undefined>>;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	readonly cloudExperts: readonly MarketAbility[];
	readonly plugins: readonly BlueprintDisplayPlugin[];
	readonly loading: boolean;
	readonly error?: string;
	readonly setError: (error: string | undefined) => void;
	readonly reload: () => Promise<void>;
}

export function useAgentTeamResources(): AgentTeamResources {
	const [document, setDocument] = useState<AgentTeamDocument>();
	const [blueprints, setBlueprints] = useState<readonly AgentBlueprint[]>([]);
	const [capabilities, setCapabilities] = useState<readonly AgentCapabilityOption[]>([]);
	const [cloudExperts, setCloudExperts] = useState<readonly MarketAbility[]>([]);
	const [plugins, setPlugins] = useState<readonly BlueprintDisplayPlugin[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const applyResources = useCallback((resources: Awaited<ReturnType<typeof loadAgentTeamConfigurationResources>>) => {
		setDocument(resources.document);
		setBlueprints(resources.blueprints);
		setCapabilities(resources.capabilities);
		setCloudExperts(resources.cloudExperts);
		setPlugins(resources.plugins);
	}, []);

	useEffect(() => {
		let cancelled = false;
		void loadAgentTeamConfigurationResources()
			.then((resources) => {
				if (!cancelled) applyResources(resources);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(agentTeamErrorMessage(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [applyResources]);

	const reload = useCallback(async () => {
		try {
			applyResources(await loadAgentTeamConfigurationResources());
			setError(undefined);
		} catch (cause) {
			setError(agentTeamErrorMessage(cause));
		}
	}, [applyResources]);

	useEffect(() => window.vetta.agentTeams.onChanged(() => void reload()), [reload]);

	return {
		document: useLocalizedAgentTeamDocument(document),
		setDocument,
		blueprints,
		capabilities,
		cloudExperts,
		plugins,
		loading,
		error,
		setError,
		reload,
	};
}

export function agentTeamErrorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
