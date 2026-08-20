/** Composes `extensions.list` + `actions.list` + `can/list_codecs` (per agent)
 *  into a `CanTxDiscovery` driven by the pure resolver. No selected-agent is
 *  passed in — discovery is agent-set-wide; the UI picks which one to focus
 *  on after seeing the full picture.
 *
 *  Polling cadence:
 *  - extensions.list + actions.list: every 5s (lifecycle changes are rare).
 *  - can/list_codecs: every 5s per agent that has the extension running.
 *    Codec churn (bus add/remove via extension restart) is also rare, so
 *    aggressive polling is wasteful.
 */

import { actions, extensions, type BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { CAN_EXTENSION_INSTALL_IDS, resolveCanActionPrefix } from "../lib/types";
import { listCodecs } from "../lib/can-bridge";
import { discoverCanTx, missingCanMethods, type CanTxDiscovery } from "../lib/capability";

export interface UseCanDiscoveryInput {
  bridge: BridgeTransport | null;
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
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

  // Only ask for codecs from agents that look like they're running the CAN
  // extension — calling it against an agent that doesn't have the extension
  // produces a noisy "unknown action" error per poll cycle.
  //
  // The namespace comes from the agent's own action list rather than a
  // constant: this call is itself part of discovery, so it cannot wait for the
  // resolver downstream to name the prefix. An agent whose actions have not
  // arrived yet, or whose namespace serves less than the full CAN surface, is
  // skipped — the resolver reports that as missing actions rather than us
  // polling a namespace we would refuse to write to.
  const codecTargets = useMemo<{ agent: string; prefix: string }[]>(() => {
    const byAgent = extensionsQuery.data;
    const actionsByAgent = actionsQuery.data;
    if (!byAgent || !actionsByAgent) return [];
    const result: { agent: string; prefix: string }[] = [];
    for (const [agent, exts] of Object.entries(byAgent)) {
      if (!exts.some((e) => CAN_EXTENSION_INSTALL_IDS.has(e.id) && e.state === "running")) continue;
      const paths = actionsByAgent[agent] ?? [];
      const prefix = resolveCanActionPrefix(paths);
      // Same completeness gate the writes use, so a partial namespace is never
      // polled every 5s.
      if (prefix === null || missingCanMethods(paths, prefix).length > 0) continue;
      result.push({ agent, prefix });
    }
    return result.sort((a, b) => a.agent.localeCompare(b.agent));
  }, [extensionsQuery.data, actionsQuery.data]);

  const codecQueries = useQueries({
    queries: codecTargets.map(({ agent, prefix }) => ({
      // The prefix is part of the key: an extension upgraded under a running
      // app changes namespace, and the cached codec list from the old one is
      // not an answer about the new one.
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
