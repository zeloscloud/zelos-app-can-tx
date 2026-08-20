/** CAN-TX discovery + per-agent capability — pure functions. No React, no IO.
 *
 *  Discovery model:
 *  1. `extensions.list` tells us which agents have the CAN extension
 *     installed and what its run state is.
 *  2. `actions.list` tells us which `can/<method>` paths are registered
 *     (every running CAN extension should expose the full REQUIRED_CAN_METHODS
 *     set under a single global namespace).
 *  3. `can/list_codecs` (one call per agent, after #1 and #2 confirm the
 *     extension is up) returns the names of the buses currently configured.
 *     Each codec name is a "ready bus" by definition — there's no per-bus
 *     readiness state anymore, because the action set is global.
 *
 *  Top-level disabled cases are only the things that aren't per-agent:
 *  workspace not LIVE, or zero agents reachable at all. */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import {
  canActionPath,
  CAN_EXTENSION_INSTALL_IDS,
  LEGACY_CAN_ACTION_PREFIX,
  REQUIRED_CAN_METHODS,
  resolveCanActionPrefix,
} from "./types";

export type AgentStatusKind =
  | "ready"
  | "extension-missing"
  | "extension-stopped"
  | "no-ready-buses"
  /** Extension is up + actions registered, but the discovery RPC hasn't
   *  resolved yet. The UI renders a placeholder header while this loads. */
  | "discovering-codecs";

export interface ReadyBus {
  /** Codec name — the value passed as `codec` to per-bus actions. */
  name: string;
}

export interface AgentStatus {
  agent: string;
  kind: AgentStatusKind;
  /** Present when an extension entry was found, regardless of its run state. */
  extension?: ExtensionEntry;
  /** Present only when `kind === "ready"`. */
  buses?: readonly ReadyBus[];
  /** Namespace this agent serves the CAN actions under, discovered from its
   *  own action list. Present only when `kind === "ready"`, which is the only
   *  state in which a caller may issue an action. Pass it to
   *  {@link canActionPath} rather than assuming a casing. */
  actionPrefix?: string;
  /** Present only when `kind === "no-ready-buses"` and we know the action
   *  surface itself is missing methods (vs. having zero codecs configured). */
  missingMethods?: readonly string[];
  /** Every CAN install running on this agent, set only when more than one is.
   *  An action path names a namespace but never an install, so nothing here can
   *  say which of them a transmit reaches — while `extension` (what Start/Stop
   *  acts on) is necessarily just one of them. Surfaced to the operator. */
  ambiguousInstalls?: readonly ExtensionEntry[];
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
  /** Codec names per agent from `can/list_codecs` (one call per agent the
   *  capability resolver is willing to query — see hook for the gating logic).
   *  `undefined` means "not yet fetched"; `[]` means "fetched, zero codecs". */
  codecsByAgent: Record<string, string[] | undefined> | null;
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

  const agents: AgentStatus[] = [...addrs]
    .sort()
    .map((agent) =>
      resolveAgentStatus(
        agent,
        input.extensionsByAgent?.[agent] ?? [],
        input.actionsByAgent?.[agent] ?? [],
        input.codecsByAgent?.[agent],
      ),
    );
  return { kind: "ready", agents };
}

/** Per-agent status computation. Pure. */
export function resolveAgentStatus(
  agent: string,
  extensions: readonly ExtensionEntry[],
  actionPaths: readonly string[],
  /** Names returned by `can/list_codecs` on this agent, or `undefined` if the
   *  RPC hasn't completed yet. */
  codecs: readonly string[] | undefined,
): AgentStatus {
  // Match any known install ID (marketplace canonical OR `local.*` aliases the
  // install-local CLI assigns). Different install methods, same extension.
  // Sorted by id because `extensions.list` order is not a contract, and the
  // Stop control must not retarget itself between refreshes.
  const installs = extensions
    .filter((e) => CAN_EXTENSION_INSTALL_IDS.has(e.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (installs.length === 0) {
    return { agent, kind: "extension-missing" };
  }

  // A stopped install serves no actions, so preferring one over a running
  // sibling would aim Start/Stop at an extension that is not the transmitter.
  const running = installs.filter((e) => e.state === "running");
  const ext = running[0] ?? installs[0]!;
  if (running.length === 0) {
    return { agent, kind: "extension-stopped", extension: ext };
  }

  const status = resolveRunningStatus(agent, ext, actionPaths, codecs);
  // Two running installs both serve the full method set under their own
  // namespace, and no field joins a namespace back to an install — so which
  // one a transmit reaches is not knowable here. Reported rather than guessed,
  // because Start/Stop can only target one of them.
  return running.length > 1 ? { ...status, ambiguousInstalls: running } : status;
}

/** Status for an agent whose CAN extension is up. `ext` is the entry the
 *  lifecycle controls act on. */
function resolveRunningStatus(
  agent: string,
  ext: ExtensionEntry,
  actionPaths: readonly string[],
  codecs: readonly string[] | undefined,
): AgentStatus {
  // Which namespace this agent serves the actions under. Discovered, not
  // assumed: the extension addresses them under its manifest name (`CAN`),
  // older builds used `can`, and an agent may be running either.
  const prefix = resolveCanActionPrefix(actionPaths);
  if (prefix === null) {
    // No namespace here serves the discovery action, so every method is
    // missing. Reported the same way a partial surface is, rather than
    // guessing a prefix and reporting each call as an unknown action.
    return {
      agent,
      kind: "no-ready-buses",
      extension: ext,
      missingMethods: [...REQUIRED_CAN_METHODS],
    };
  }

  // Confirm every required action path is registered. A missing action path
  // here means the extension is the wrong version (or didn't finish
  // registering), not that buses are misconfigured.
  const missing = missingCanMethods(actionPaths, prefix);
  if (missing.length > 0) {
    return { agent, kind: "no-ready-buses", extension: ext, missingMethods: missing };
  }

  // Action set is good. Now we need the codec list.
  if (codecs === undefined) {
    return { agent, kind: "discovering-codecs", extension: ext };
  }
  if (codecs.length === 0) {
    return { agent, kind: "no-ready-buses", extension: ext };
  }

  return {
    agent,
    kind: "ready",
    extension: ext,
    buses: codecs.map((name) => ({ name })),
    actionPrefix: prefix,
  };
}

/** Required methods the resolved namespace does not serve, in declaration
 *  order. Empty means the full surface is present — the single gate for
 *  issuing any action against that namespace, reads included. */
export function missingCanMethods(
  actionPaths: readonly string[],
  prefix: string,
): readonly string[] {
  const actionSet = new Set(actionPaths);
  return REQUIRED_CAN_METHODS.filter((m) => !actionSet.has(canActionPath(m, prefix)));
}

/** The namespace to address this agent's CAN actions under.
 *
 *  `actionPrefix` is set on every `ready` status, so the fallback is
 *  unreachable today — it exists because `AgentStatus` is a flat interface the
 *  compiler cannot narrow on `kind`. Falling back to the pre-rename prefix
 *  keeps an older install working rather than sending an empty namespace.
 */
export function agentActionPrefix(status: AgentStatus): string {
  return status.actionPrefix ?? LEGACY_CAN_ACTION_PREFIX;
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
      return status.missingMethods?.length
        ? `missing actions: ${status.missingMethods.join(", ")}`
        : "no buses configured";
    case "discovering-codecs":
      return "discovering buses…";
  }
}
