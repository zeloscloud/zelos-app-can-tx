/** Typed wrapper over the generic `actions.*` + `extensions.list` bridge methods.
 *
 *  Why a wrapper: the SDK facades take freeform JSON; this file pins the CAN-side
 *  action paths and parameter shapes so callers can't accidentally pass the
 *  wrong action name or drop required fields. The translation is intentionally
 *  thin — no caching, no retries, no debouncing. Let TanStack Query own those. */

import { actions, extensions, type BridgeTransport, type ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import {
  CAN_ACTIONS,
  type CanActionResult,
  type CanTransmitState,
  type DbcCatalog,
  type SendMessageParams,
  type SendRawParams,
  type StartPeriodicMessageParams,
  type StartPeriodicRawParams,
  type StartPeriodicResult,
  type StopPeriodicParams,
} from "./types";

/** Per-agent action discovery — used by the capability resolver to know
 *  whether the CAN extension has registered the actions we need. */
export async function listActionsPerAgent(bridge: BridgeTransport): Promise<Record<string, string[]>> {
  return await actions.list(bridge);
}

/** Per-agent installed-extension discovery. */
export async function listExtensionsPerAgent(bridge: BridgeTransport): Promise<Record<string, ExtensionEntry[]>> {
  return await extensions.list(bridge);
}

/** Single-shot state snapshot — buses, periodics, tx/rx metrics. */
export async function getTxState(bridge: BridgeTransport, agent: string): Promise<CanTransmitState> {
  const res = await actions.execute<CanTransmitState>(bridge, {
    agent,
    action: CAN_ACTIONS.getTxState,
  });
  ensurePass(res);
  return res.result;
}

/** Read the DBC catalog the CAN extension already has loaded for a bus.
 *  The app never parses or selects DBCs (CAN_TRANSMIT.md §2 decision 11). */
export async function listMessages(bridge: BridgeTransport, agent: string, bus: string): Promise<DbcCatalog> {
  const res = await actions.execute<DbcCatalog>(bridge, {
    agent,
    action: CAN_ACTIONS.listMessages,
    params: { bus },
  });
  ensurePass(res);
  return res.result;
}

export async function sendRaw(bridge: BridgeTransport, agent: string, params: SendRawParams): Promise<void> {
  const res = await actions.execute(bridge, { agent, action: CAN_ACTIONS.sendRaw, params });
  ensurePass(res);
}

export async function startPeriodicRaw(
  bridge: BridgeTransport,
  agent: string,
  params: StartPeriodicRawParams,
): Promise<StartPeriodicResult> {
  const res = await actions.execute<StartPeriodicResult>(bridge, {
    agent,
    action: CAN_ACTIONS.startPeriodicRaw,
    params,
  });
  ensurePass(res);
  return res.result;
}

export async function sendMessage(bridge: BridgeTransport, agent: string, params: SendMessageParams): Promise<void> {
  const res = await actions.execute(bridge, { agent, action: CAN_ACTIONS.sendMessage, params });
  ensurePass(res);
}

export async function startPeriodicMessage(
  bridge: BridgeTransport,
  agent: string,
  params: StartPeriodicMessageParams,
): Promise<StartPeriodicResult> {
  const res = await actions.execute<StartPeriodicResult>(bridge, {
    agent,
    action: CAN_ACTIONS.startPeriodicMessage,
    params,
  });
  ensurePass(res);
  return res.result;
}

export async function stopPeriodic(bridge: BridgeTransport, agent: string, params: StopPeriodicParams): Promise<void> {
  const res = await actions.execute(bridge, { agent, action: CAN_ACTIONS.stopPeriodic, params });
  ensurePass(res);
}

function ensurePass(res: CanActionResult): void {
  if (res.status === "pass" || res.status === "done") return;
  // Surface the host's status + any string `reason` if the extension supplied one.
  const reason =
    res.result != null && typeof res.result === "object" && "reason" in res.result
      ? String((res.result as { reason: unknown }).reason)
      : null;
  throw new Error(`CAN action failed: status=${res.status}${reason ? `, reason=${reason}` : ""}`);
}
