/** CAN-TX capability resolver — pure function. No React, no IO.
 *
 *  Per-agent, per-bus check. A bus is ready when:
 *    1. workspace mode is LIVE
 *    2. an agent is selected
 *    3. the CAN extension is installed + running on that agent
 *    4. the bus's action paths (`can/<bus>/<method>` for every required
 *       method) are all present in actions.list
 *
 *  Output is `{ kind: "ready", buses: ReadyBus[] }` (one or more buses are
 *  usable) or `{ kind: "disabled", reason }` with a precise reason. */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import {
  canActionPath,
  CAN_EXTENSION_INSTALL_IDS,
  extractBusNames,
  REQUIRED_CAN_METHODS,
} from "./types";

export type DisabledReason =
  | "no-agent"
  | "not-live"
  | "can-extension-missing"
  | "can-extension-stopped"
  | "no-ready-buses";

export interface ReadyBus {
  name: string;
  /** Methods available as `can/<name>/<method>` paths on the agent. */
  methods: readonly string[];
}

export type CanTxCapability =
  | {
      kind: "ready";
      agent: string;
      extension: ExtensionEntry;
      buses: readonly ReadyBus[];
    }
  | {
      kind: "disabled";
      reason: DisabledReason;
      agent?: string;
      extension?: ExtensionEntry;
      /** Bus names whose required action paths were incomplete. Only populated
       *  when `reason === "no-ready-buses"`. */
      partialBuses?: ReadonlyArray<{ name: string; missing: readonly string[] }>;
    };

export interface ResolveCapabilityInputs {
  /** Workspace mode reported by the bridge snapshot. */
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  /** Agent the user has selected. `null` until the user picks one (or the UI
   *  auto-selects the only connected agent). */
  selectedAgent: string | null;
  /** Installed extensions per agent from `extensions.list`. */
  extensionsByAgent: Record<string, ExtensionEntry[]> | null;
  /** Action paths per agent from `actions.list`. */
  actionsByAgent: Record<string, string[]> | null;
}

export function resolveCanTxCapability(input: ResolveCapabilityInputs): CanTxCapability {
  if (input.workspaceModeKind !== "LIVE") {
    return { kind: "disabled", reason: "not-live" };
  }
  const agent = input.selectedAgent;
  if (!agent) {
    return { kind: "disabled", reason: "no-agent" };
  }
  const extensions = input.extensionsByAgent?.[agent] ?? [];
  // Match any known install ID (marketplace canonical OR `local.*` aliases the
  // install-local CLI assigns). Different install methods, same extension.
  const canExt = extensions.find((e) => CAN_EXTENSION_INSTALL_IDS.has(e.id));
  if (!canExt) {
    return { kind: "disabled", reason: "can-extension-missing", agent };
  }
  if (canExt.state !== "running") {
    return { kind: "disabled", reason: "can-extension-stopped", agent, extension: canExt };
  }
  const actionPaths = input.actionsByAgent?.[agent] ?? [];
  const allBusNames = extractBusNames(actionPaths);
  const actionSet = new Set(actionPaths);

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
    return {
      kind: "disabled",
      reason: "no-ready-buses",
      agent,
      extension: canExt,
      partialBuses: partial,
    };
  }
  return { kind: "ready", agent, extension: canExt, buses: ready };
}
