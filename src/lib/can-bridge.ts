/** Typed wrapper over the generic `actions.*` + `extensions.list` bridge methods.
 *
 *  Why a wrapper: the SDK facades take freeform JSON; this file pins the
 *  CAN action paths and parameter shapes so callers can't accidentally
 *  pass the wrong action name or drop required fields. The translation is
 *  intentionally thin — no caching, no retries, no debouncing. Let TanStack
 *  Query own those.
 *
 *  Wire model: the CAN extension exposes a single global action namespace
 *  (`can/get_tx_state`, `can/send_message`, …). Every per-bus action carries
 *  a `codec` parameter naming the target bus. Bus discovery is via
 *  {@link listCodecs}. */

import { actions, type BridgeTransport } from "@zeloscloud/app-extension-sdk";

import {
  canActionPath,
  CAN_METHODS,
  type CanActionResult,
  type CanBusSnapshot,
  type DbcCatalog,
  type DbcMessageDescription,
  type SendMessageParams,
  type SendRawParams,
  type StartPeriodicMessageParams,
  type StartPeriodicRawParams,
  type StartPeriodicResult,
  type StopPeriodicParams,
} from "./types";

/** Names of every CAN bus the extension currently has running on the named
 *  agent. The capability resolver consumes this to enumerate ready buses. */
export async function listCodecs(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
): Promise<{ codecs: string[] }> {
  const res = await actions.execute<{ codecs: string[] }>(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.listCodecs, prefix),
    params: {},
  });
  ensurePass(res);
  return res.result;
}

export async function getBusSnapshot(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
): Promise<CanBusSnapshot> {
  const res = await actions.execute<CanBusSnapshot>(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.getTxState, prefix),
    params: { codec },
  });
  ensurePass(res);
  return res.result;
}

export async function sendRaw(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
  params: SendRawParams,
): Promise<void> {
  const res = await actions.execute(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.sendRaw, prefix),
    params: { codec, ...params },
  });
  ensurePass(res);
}

export async function startPeriodicRaw(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
  params: StartPeriodicRawParams,
): Promise<StartPeriodicResult> {
  const res = await actions.execute<StartPeriodicResult>(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.startPeriodicRaw, prefix),
    params: { codec, ...params },
  });
  ensurePass(res);
  return res.result;
}

export async function stopPeriodic(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
  params: StopPeriodicParams,
): Promise<void> {
  const res = await actions.execute(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.stopPeriodic, prefix),
    params: { codec, ...params },
  });
  ensurePass(res);
}

export async function listMessages(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
): Promise<DbcCatalog> {
  const res = await actions.execute<DbcCatalog>(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.listMessages, prefix),
    params: { codec },
  });
  ensurePass(res);
  return res.result;
}

export async function describeMessage(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
  message: string,
): Promise<DbcMessageDescription> {
  const res = await actions.execute<DbcMessageDescription>(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.describeMessage, prefix),
    params: { codec, message },
  });
  ensurePass(res);
  return res.result;
}

export async function sendMessage(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
  params: SendMessageParams,
): Promise<void> {
  const res = await actions.execute(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.sendMessage, prefix),
    params: { codec, ...params },
  });
  ensurePass(res);
}

export async function startPeriodicMessage(
  bridge: BridgeTransport,
  agent: string,
  prefix: string,
  codec: string,
  params: StartPeriodicMessageParams,
): Promise<StartPeriodicResult> {
  const res = await actions.execute<StartPeriodicResult>(bridge, {
    agent,
    action: canActionPath(CAN_METHODS.startPeriodicMessage, prefix),
    params: { codec, ...params },
  });
  ensurePass(res);
  return res.result;
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
