/** Polls a bus's `get_tx_state` at 1 Hz, so its receive counters stay live. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getBusSnapshot } from "../lib/can-bridge";
import type { CanBusSnapshot } from "../lib/types";

const SNAPSHOT_POLL_MS = 1_000;

export function useBusSnapshot(
  bridge: BridgeTransport | null,
  agent: string | null,
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
