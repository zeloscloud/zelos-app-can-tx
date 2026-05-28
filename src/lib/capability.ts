/** CAN-TX discovery + per-agent capability — pure functions. No React, no IO.
 *
 *  Discovery is dynamic: every agent the desktop is currently talking to shows
 *  up in `extensions.list` / `actions.list` fan-out keys. For each one we
 *  compute a status (`ready` / `extension-missing` / `extension-stopped` /
 *  `no-ready-buses`) so the UI can render the full agent picture, not just a
 *  single user-picked agent.
 *
 *  Top-level disabled cases are only the things that aren't per-agent:
 *  workspace not LIVE, or zero agents reachable at all. */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import {
  canActionPath,
  CAN_EXTENSION_INSTALL_IDS,
  extractBusNames,
  REQUIRED_CAN_METHODS,
} from "./types";

export type AgentStatusKind =
  | "ready"
  | "extension-missing"
  | "extension-stopped"
  | "no-ready-buses";

export interface ReadyBus {
  name: string;
  /** Methods available as `can/<name>/<method>` paths on the agent. */
  methods: readonly string[];
}

export interface AgentStatus {
  agent: string;
  kind: AgentStatusKind;
  /** Present when an extension entry was found, regardless of its run state. */
  extension?: ExtensionEntry;
  /** Present only when `kind === "ready"`. */
  buses?: readonly ReadyBus[];
  /** Present only when `kind === "no-ready-buses"`. */
  partialBuses?: ReadonlyArray<{ name: string; missing: readonly string[] }>;
}

export type TopLevelDisabledReason = "not-live" | "no-agents-connected";

export type CanTxDiscovery =
  | { kind: "ready"; agents: readonly AgentStatus[] }
  | { kind: "disabled"; reason: TopLevelDisabledReason };

export interface DiscoverInputs {
  /** Workspace mode reported by the bridge snapshot. */
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  /** Installed extensions per agent from `extensions.list` (fan-out). */
  extensionsByAgent: Record<string, ExtensionEntry[]> | null;
  /** Action paths per agent from `actions.list` (fan-out). */
  actionsByAgent: Record<string, string[]> | null;
}

/** Top-level discovery: builds the agent list + status, or returns a disabled
 *  reason for cases that aren't per-agent (workspace mode, zero agents). */
export function discoverCanTx(input: DiscoverInputs): CanTxDiscovery {
  if (input.workspaceModeKind !== "LIVE") {
    return { kind: "disabled", reason: "not-live" };
  }
  // Union of agent addresses across both fan-outs — either source can be the
  // first to learn about an agent depending on registration race.
  const addrs = new Set<string>();
  if (input.extensionsByAgent) Object.keys(input.extensionsByAgent).forEach((a) => addrs.add(a));
  if (input.actionsByAgent) Object.keys(input.actionsByAgent).forEach((a) => addrs.add(a));

  if (addrs.size === 0) {
    return { kind: "disabled", reason: "no-agents-connected" };
  }

  const agents: AgentStatus[] = [...addrs].sort().map((agent) =>
    resolveAgentStatus(
      agent,
      input.extensionsByAgent?.[agent] ?? [],
      input.actionsByAgent?.[agent] ?? [],
    ),
  );
  return { kind: "ready", agents };
}

/** Per-agent status computation. Pure. */
export function resolveAgentStatus(
  agent: string,
  extensions: readonly ExtensionEntry[],
  actionPaths: readonly string[],
): AgentStatus {
  // Match any known install ID (marketplace canonical OR `local.*` aliases the
  // install-local CLI assigns). Different install methods, same extension.
  const ext = extensions.find((e) => CAN_EXTENSION_INSTALL_IDS.has(e.id));
  if (!ext) {
    return { agent, kind: "extension-missing" };
  }
  if (ext.state !== "running") {
    return { agent, kind: "extension-stopped", extension: ext };
  }

  const actionSet = new Set(actionPaths);
  const allBusNames = extractBusNames(actionPaths);
  const ready: ReadyBus[] = [];
  const partial: Array<{ name: string; missing: string[] }> = [];
  for (const busName of allBusNames) {
    const methods: string[] = [];
    const missing: string[] = [];
    for (const method of REQUIRED_CAN_METHODS) {
      if (actionSet.has(canActionPath(busName, method))) methods.push(method);
      else missing.push(method);
    }
    if (missing.length === 0) ready.push({ name: busName, methods });
    else partial.push({ name: busName, missing });
  }

  if (ready.length === 0) {
    return { agent, kind: "no-ready-buses", extension: ext, partialBuses: partial };
  }
  return { agent, kind: "ready", extension: ext, buses: ready };
}

/** Short text label for the agent's status, used in chips + tooltips. */
export function statusLabel(status: AgentStatus): string {
  switch (status.kind) {
    case "ready":
      return `ready (${status.buses?.length ?? 0} bus${status.buses?.length === 1 ? "" : "es"})`;
    case "extension-missing":
      return "CAN extension not installed";
    case "extension-stopped":
      return `CAN extension ${status.extension?.state ?? "stopped"}`;
    case "no-ready-buses":
      return "no usable buses";
  }
}
