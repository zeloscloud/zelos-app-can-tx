/** TanStack Query hook for the per-bus `get_tx_state` snapshot.
 *
 *  Polls at 1 Hz unconditionally so the bus-stats card stays live even when
 *  no periodics are active — RX counters tick up from agent-side decoding,
 *  not from anything the app does. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBusSnapshot } from "../lib/can-bridge";
import type { CanBusSnapshot } from "../lib/types";

const SNAPSHOT_POLL_MS = 1_000;

export function useBusSnapshot(
  bridge: BridgeTransport | null,
  agent: string | null,
  /** Action namespace for `agent`, from the ready status. Null until discovery
   *  has named it, which also gates the query. Ordered to mirror the bridge
   *  layer's `(bridge, agent, prefix, codec)` so the two cannot be transposed
   *  by muscle memory — both are `string`, so the compiler would not catch it. */
  prefix: string | null,
  bus: string | null,
): UseQueryResult<CanBusSnapshot> {
  return useQuery<CanBusSnapshot>({
    queryKey: ["can-bus-snapshot", agent, prefix, bus],
    queryFn: async () => {
      if (!bridge || !agent || !bus || !prefix) {
        throw new Error("useBusSnapshot: bridge/agent/bus/prefix missing");
      }
      return await getBusSnapshot(bridge, agent, prefix, bus);
    },
    enabled: bridge !== null && agent !== null && bus !== null && prefix !== null,
    staleTime: SNAPSHOT_POLL_MS,
    refetchInterval: SNAPSHOT_POLL_MS,
    refetchOnWindowFocus: true,
  });
}
