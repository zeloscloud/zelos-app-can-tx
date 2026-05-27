/** Composes `extensions.list` + `actions.list` + `get_tx_state` into a single
 *  `CanTxCapability` driven by the resolver. Selected-agent + workspace mode
 *  come from the caller so the hook stays free of UI concerns. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listActionsPerAgent, listExtensionsPerAgent } from "../lib/can-bridge";
import { resolveCanTxCapability, type CanTxCapability } from "../lib/capability";
import { useTxState } from "./use-tx-state";

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
    queryKey: ["can-tx-extensions-list"],
    queryFn: async () => listExtensionsPerAgent(input.bridge!),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 5000 : false,
  });

  const actionsQuery = useQuery({
    queryKey: ["can-tx-actions-list"],
    queryFn: async () => listActionsPerAgent(input.bridge!),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 5000 : false,
  });

  const txStateQuery = useTxState(input.bridge, input.selectedAgent);

  const capability = useMemo(
    () =>
      resolveCanTxCapability({
        workspaceModeKind: input.workspaceModeKind,
        selectedAgent: input.selectedAgent,
        extensionsByAgent: extensionsQuery.data ?? null,
        actionsByAgent: actionsQuery.data ?? null,
        txState: txStateQuery.data ?? null,
      }),
    [
      input.workspaceModeKind,
      input.selectedAgent,
      extensionsQuery.data,
      actionsQuery.data,
      txStateQuery.data,
    ],
  );

  return {
    capability,
    isLoading: extensionsQuery.isLoading || actionsQuery.isLoading,
    refetch: () => {
      void extensionsQuery.refetch();
      void actionsQuery.refetch();
      void txStateQuery.refetch();
    },
  };
}
