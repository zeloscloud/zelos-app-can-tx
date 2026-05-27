/** TanStack Query hook for the per-bus `get_tx_state` snapshot.
 *
 *  Refetch every 2 s while the bus has at least one active periodic, disabled
 *  otherwise. No bespoke cache layer — TanStack Query already dedupes
 *  concurrent queries via `staleTime` and `gcTime`. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBusSnapshot } from "../lib/can-bridge";
import type { CanBusSnapshot } from "../lib/types";

export function useBusSnapshot(
  bridge: BridgeTransport | null,
  agent: string | null,
  bus: string | null,
): UseQueryResult<CanBusSnapshot> {
  return useQuery<CanBusSnapshot>({
    queryKey: ["can-bus-snapshot", agent, bus],
    queryFn: async () => {
      if (!bridge || !agent || !bus) throw new Error("useBusSnapshot: bridge/agent/bus missing");
      return await getBusSnapshot(bridge, agent, bus);
    },
    enabled: bridge !== null && agent !== null && bus !== null,
    staleTime: 1000,
    refetchInterval: (query) => {
      const snap = query.state.data;
      return snap?.bus.periodics.length ? 2000 : false;
    },
    refetchOnWindowFocus: true,
  });
}
