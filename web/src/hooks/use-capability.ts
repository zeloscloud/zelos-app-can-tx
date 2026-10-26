/** Polls extensions, actions and each agent's `list_codecs` every 5 s into a CanTxDiscovery. */

import {
  actions,
  extensions,
  type AppBridgeWorkspaceInfo,
  type BridgeTransport,
} from "@zeloscloud/app-extension-sdk";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { CAN_EXTENSION_INSTALL_IDS, resolveCanActionPrefix } from "../lib/types";
import { listCodecs } from "../lib/can-bridge";
import { discoverCanTx, missingCanMethods, type CanTxDiscovery } from "../lib/capability";

export interface UseCanDiscoveryInput {
  bridge: BridgeTransport | null;
  workspaceModeKind: AppBridgeWorkspaceInfo["modeKind"];
}

export function useCanDiscovery(input: UseCanDiscoveryInput): {
  discovery: CanTxDiscovery;
  isLoading: boolean;
  refetch: () => void;
} {
  const enabled = input.bridge !== null && input.workspaceModeKind === "LIVE";

  const extensionsQuery = useQuery({
    queryKey: ["can-extensions-list"],
    queryFn: async () => extensions.list(input.bridge!),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 5000 : false,
  });

  const actionsQuery = useQuery({
    queryKey: ["can-actions-list"],
    queryFn: async () => actions.list(input.bridge!),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 5000 : false,
  });

  // Only agents running the full CAN surface: any other answers each poll with an unknown action.
  const codecTargets = useMemo<{ agent: string; prefix: string }[]>(() => {
    const byAgent = extensionsQuery.data;
    const actionsByAgent = actionsQuery.data;
    if (!byAgent || !actionsByAgent) return [];
    const result: { agent: string; prefix: string }[] = [];
    for (const [agent, exts] of Object.entries(byAgent)) {
      if (!exts.some((e) => CAN_EXTENSION_INSTALL_IDS.has(e.id) && e.state === "running")) continue;
      const paths = actionsByAgent[agent] ?? [];
      const prefix = resolveCanActionPrefix(paths);
      if (prefix === null || missingCanMethods(paths, prefix).length > 0) continue;
      result.push({ agent, prefix });
    }
    return result.sort((a, b) => a.agent.localeCompare(b.agent));
  }, [extensionsQuery.data, actionsQuery.data]);

  const codecQueries = useQueries({
    queries: codecTargets.map(({ agent, prefix }) => ({
      // An extension update can change the namespace, so the cached list must not carry over.
      queryKey: ["can-list-codecs", agent, prefix],
      queryFn: async () => listCodecs(input.bridge!, agent, prefix),
      enabled,
      staleTime: 2000,
      refetchInterval: enabled ? 5000 : false,
    })),
  });

  const codecsByAgent = useMemo<Record<string, string[] | undefined>>(() => {
    const out: Record<string, string[] | undefined> = {};
    codecTargets.forEach(({ agent }, i) => {
      out[agent] = codecQueries[i]?.data?.codecs;
    });
    return out;
  }, [codecTargets, codecQueries]);

  const discovery = useMemo(
    () =>
      discoverCanTx({
        workspaceModeKind: input.workspaceModeKind,
        extensionsByAgent: extensionsQuery.data ?? null,
        actionsByAgent: actionsQuery.data ?? null,
        codecsByAgent,
      }),
    [input.workspaceModeKind, extensionsQuery.data, actionsQuery.data, codecsByAgent],
  );

  return {
    discovery,
    isLoading:
      extensionsQuery.isLoading || actionsQuery.isLoading || codecQueries.some((q) => q.isLoading),
    refetch: () => {
      void extensionsQuery.refetch();
      void actionsQuery.refetch();
      codecQueries.forEach((q) => void q.refetch());
    },
  };
}
