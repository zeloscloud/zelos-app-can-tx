/** Composes `extensions.list` + `actions.list` into a `CanTxDiscovery` driven
 *  by the pure resolver. No selected-agent is passed in — discovery is
 *  agent-set-wide; the UI picks which one to focus on after seeing the
 *  full picture. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listActionsPerAgent, listExtensionsPerAgent } from "../lib/can-bridge";
import { discoverCanTx, type CanTxDiscovery } from "../lib/capability";

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
    queryFn: async () => listExtensionsPerAgent(input.bridge!),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 5000 : false,
  });

  const actionsQuery = useQuery({
    queryKey: ["can-actions-list"],
    queryFn: async () => listActionsPerAgent(input.bridge!),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 5000 : false,
  });

  const discovery = useMemo(
    () =>
      discoverCanTx({
        workspaceModeKind: input.workspaceModeKind,
        extensionsByAgent: extensionsQuery.data ?? null,
        actionsByAgent: actionsQuery.data ?? null,
      }),
    [input.workspaceModeKind, extensionsQuery.data, actionsQuery.data],
  );

  return {
    discovery,
    isLoading: extensionsQuery.isLoading || actionsQuery.isLoading,
    refetch: () => {
      void extensionsQuery.refetch();
      void actionsQuery.refetch();
    },
  };
}
