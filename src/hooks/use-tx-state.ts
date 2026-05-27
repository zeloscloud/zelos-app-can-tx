/** TanStack Query hook for the `get_tx_state` snapshot.
 *
 *  Per CAN_TRANSMIT.md §8.6 + Pass 2: refetch every 2 s while any periodic is
 *  active, disabled otherwise. No bespoke cache layer — TanStack Query already
 *  dedupes concurrent queries via `staleTime` and `gcTime`. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getTxState } from "../lib/can-bridge";
import type { CanTransmitState } from "../lib/types";

export function useTxState(
  bridge: BridgeTransport | null,
  agent: string | null,
): UseQueryResult<CanTransmitState> {
  return useQuery<CanTransmitState>({
    queryKey: ["can-tx-state", agent],
    queryFn: async () => {
      if (!bridge || !agent) throw new Error("useTxState: bridge or agent missing");
      return await getTxState(bridge, agent);
    },
    enabled: bridge !== null && agent !== null,
    staleTime: 1000,
    refetchInterval: (query) => {
      const state = query.state.data;
      const hasPeriodics = state?.buses.some((b) => b.periodics.length > 0) ?? false;
      return hasPeriodics ? 2000 : false;
    },
    refetchOnWindowFocus: true,
  });
}
