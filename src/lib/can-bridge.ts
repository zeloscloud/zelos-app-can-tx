/** Typed wrapper over the generic `actions.*` + `extensions.list` bridge methods.
 *
 *  Why a wrapper: the SDK facades take freeform JSON; this file pins the
 *  CAN action paths and parameter shapes so callers can't accidentally
 *  pass the wrong action name or drop required fields. The translation is
 *  intentionally thin — no caching, no retries, no debouncing. Let TanStack
 *  Query own those.
 *
 *  Each call addresses a single (agent, bus) pair. Paths land as
 *  `can/<bus>/<method>`; the bus is implicit in the codec instance on the
 *  agent side so action params don't carry a `bus` field.
 *
 *  Only the methods the v1 raw-TX flow needs are exposed here. DBC-encoded
 *  wrappers (`send_message`, `start_periodic_message`) and the DBC catalog
 *  reader (`list_messages`) are exercised via raw `actions.execute` for now
 *  and will get typed wrappers when the DBC composer lands. */

import { actions, extensions, type BridgeTransport, type ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import {
  canActionPath,
  CAN_METHODS,
  type CanActionResult,
  type CanBusSnapshot,
  type SendRawParams,
  type StartPeriodicRawParams,
  type StartPeriodicResult,
  type StopPeriodicParams,
} from "./types";

/** Per-agent action discovery — used by the capability resolver to figure out
 *  which buses are present (every bus surfaces `can/<bus>/get_tx_state`). */
export async function listActionsPerAgent(bridge: BridgeTransport): Promise<Record<string, string[]>> {
  return await actions.list(bridge);
}

/** Per-agent installed-extension discovery. */
export async function listExtensionsPerAgent(bridge: BridgeTransport): Promise<Record<string, ExtensionEntry[]>> {
  return await extensions.list(bridge);
}

export async function getBusSnapshot(bridge: BridgeTransport, agent: string, bus: string): Promise<CanBusSnapshot> {
  const res = await actions.execute<CanBusSnapshot>(bridge, {
    agent,
    action: canActionPath(bus, CAN_METHODS.getTxState),
    // Always send a JSON object on the wire, even for no-arg actions. NAPI
    // marshals `undefined` to a null and some action runtimes reject that;
    // explicit `{}` is the safe shape.
    params: {},
  });
  ensurePass(res);
  return res.result;
}

export async function sendRaw(
  bridge: BridgeTransport,
  agent: string,
  bus: string,
  params: SendRawParams,
): Promise<void> {
  const res = await actions.execute(bridge, {
    agent,
    action: canActionPath(bus, CAN_METHODS.sendRaw),
    params,
  });
  ensurePass(res);
}

export async function startPeriodicRaw(
  bridge: BridgeTransport,
  agent: string,
  bus: string,
  params: StartPeriodicRawParams,
): Promise<StartPeriodicResult> {
  const res = await actions.execute<StartPeriodicResult>(bridge, {
    agent,
    action: canActionPath(bus, CAN_METHODS.startPeriodicRaw),
    params,
  });
  ensurePass(res);
  return res.result;
}

export async function stopPeriodic(
  bridge: BridgeTransport,
  agent: string,
  bus: string,
  params: StopPeriodicParams,
): Promise<void> {
  const res = await actions.execute(bridge, {
    agent,
    action: canActionPath(bus, CAN_METHODS.stopPeriodic),
    params,
  });
  ensurePass(res);
}

function ensurePass(res: CanActionResult): void {
  if (res.status === "pass" || res.status === "done") return;
  // Pull whatever detail we can off `result` — agents emit different
  // shapes (a `{reason}` object, a raw string, or just the error dict).
  // Falling back to JSON.stringify keeps the surface useful when the
  // shape is unfamiliar so bug reports include the actual failure.
  let detail: string | null = null;
  if (res.result != null && typeof res.result === "object") {
    if ("reason" in res.result) {
      detail = String((res.result as { reason: unknown }).reason);
    } else if ("error" in res.result) {
      detail = String((res.result as { error: unknown }).error);
    } else {
      try {
        detail = JSON.stringify(res.result);
      } catch {
        // ignore
      }
    }
  } else if (typeof res.result === "string" && res.result.length > 0) {
    detail = res.result;
  }
  throw new Error(`CAN action failed: status=${res.status}${detail ? `, ${detail}` : ""}`);
}
