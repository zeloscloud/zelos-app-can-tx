import type { AppBridgeWorkspaceInfo, ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import {
  canActionPath,
  CAN_EXTENSION_INSTALL_IDS,
  REQUIRED_CAN_METHODS,
  resolveCanActionPrefix,
} from "./types";

type AgentStatusKind =
  "ready" | "extension-missing" | "extension-stopped" | "no-ready-buses" | "discovering-codecs";

interface ReadyBus {
  name: string;
}

export interface AgentStatus {
  agent: string;
  kind: AgentStatusKind;
  extension?: ExtensionEntry;
  /** Set only when `kind === "ready"`. */
  buses?: readonly ReadyBus[];
  /** Set only when `kind === "ready"`, the only state in which to issue an action. */
  actionPrefix?: string;
  missingMethods?: readonly string[];
  /** Set when more than one CAN install runs: no action path says which one a transmit reaches. */
  ambiguousInstalls?: readonly ExtensionEntry[];
}

export type TopLevelDisabledReason = "not-live" | "no-agents-connected";

export type CanTxDiscovery =
  | { kind: "ready"; agents: readonly AgentStatus[] }
  | { kind: "disabled"; reason: TopLevelDisabledReason };

export interface DiscoverInputs {
  workspaceModeKind: AppBridgeWorkspaceInfo["modeKind"];
  extensionsByAgent: Record<string, ExtensionEntry[]> | null;
  actionsByAgent: Record<string, string[]> | null;
  /** `undefined` for an agent means not fetched yet; `[]` means no buses. */
  codecsByAgent: Record<string, string[] | undefined> | null;
}

export function discoverCanTx(input: DiscoverInputs): CanTxDiscovery {
  if (input.workspaceModeKind !== "LIVE") {
    return { kind: "disabled", reason: "not-live" };
  }
  // Either list can learn about an agent first.
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

export function resolveAgentStatus(
  agent: string,
  extensions: readonly ExtensionEntry[],
  actionPaths: readonly string[],
  codecs: readonly string[] | undefined,
): AgentStatus {
  // Sorted, so the Stop control keeps its target across refreshes.
  const installs = extensions
    .filter((e) => CAN_EXTENSION_INSTALL_IDS.has(e.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (installs.length === 0) {
    return { agent, kind: "extension-missing" };
  }

  // A stopped install serves no actions, so Start/Stop targets a running one first.
  const running = installs.filter((e) => e.state === "running");
  const ext = running[0] ?? installs[0]!;
  if (running.length === 0) {
    return { agent, kind: "extension-stopped", extension: ext };
  }

  const status = resolveRunningStatus(agent, ext, actionPaths, codecs);
  return running.length > 1 ? { ...status, ambiguousInstalls: running } : status;
}

function resolveRunningStatus(
  agent: string,
  ext: ExtensionEntry,
  actionPaths: readonly string[],
  codecs: readonly string[] | undefined,
): AgentStatus {
  const prefix = resolveCanActionPrefix(actionPaths);
  if (prefix === null) {
    return {
      agent,
      kind: "no-ready-buses",
      extension: ext,
      missingMethods: [...REQUIRED_CAN_METHODS],
    };
  }

  const missing = missingCanMethods(actionPaths, prefix);
  if (missing.length > 0) {
    return { agent, kind: "no-ready-buses", extension: ext, missingMethods: missing };
  }

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

/** Empty means the namespace serves the full surface, the gate for every action on it. */
export function missingCanMethods(
  actionPaths: readonly string[],
  prefix: string,
): readonly string[] {
  const actionSet = new Set(actionPaths);
  return REQUIRED_CAN_METHODS.filter((m) => !actionSet.has(canActionPath(m, prefix)));
}
