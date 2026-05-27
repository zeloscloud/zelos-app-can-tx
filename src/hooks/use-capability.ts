/** Composes `extensions.list` + `actions.list` into a single `CanTxCapability`
 *  driven by the pure resolver. Selected-agent + workspace mode come from the
 *  caller so the hook stays free of UI concerns. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listActionsPerAgent, listExtensionsPerAgent } from "../lib/can-bridge";
import { resolveCanTxCapability, type CanTxCapability } from "../lib/capability";

export interface UseCanCapabilityInput {
  bridge: BridgeTransport | null;
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  selectedAgent: string | null;
}

export function useCanCapability(input: UseCanCapabilityInput): {
  capability: CanTxCapability;
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

  const capability = useMemo(
    () =>
      resolveCanTxCapability({
        workspaceModeKind: input.workspaceModeKind,
        selectedAgent: input.selectedAgent,
        extensionsByAgent: extensionsQuery.data ?? null,
        actionsByAgent: actionsQuery.data ?? null,
      }),
    [input.workspaceModeKind, input.selectedAgent, extensionsQuery.data, actionsQuery.data],
  );

  return {
    capability,
    isLoading: extensionsQuery.isLoading || actionsQuery.isLoading,
    refetch: () => {
      void extensionsQuery.refetch();
      void actionsQuery.refetch();
    },
  };
}
