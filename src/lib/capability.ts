/** CAN-TX capability resolver — pure function. No React, no IO.
 *
 *  Two-variant discriminated union (`ready` | `disabled`) with one
 *  `DisabledReason` per fixture state. UI switches on `reason` to render the
 *  banner; tests assert one fixture per reason without spinning up a React
 *  tree.
 *
 *  Inputs come from `extensions.list`, `actions.list`, the selected agent +
 *  workspace mode, and the latest `get_tx_state` snapshot (when available). */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";

import { CAN_EXTENSION_ID, REQUIRED_CAN_ACTIONS, type CanTransmitState } from "./types";

export type DisabledReason =
  | "no-agent"
  | "not-live"
  | "can-extension-missing"
  | "can-extension-stopped"
  | "can-actions-missing";

export type CanTxCapability =
  | {
      kind: "ready";
      agent: string;
      extension: ExtensionEntry;
      actions: readonly string[];
      state: CanTransmitState | null;
    }
  | {
      kind: "disabled";
      reason: DisabledReason;
      agent?: string;
      extension?: ExtensionEntry;
      /** Action paths the app expected but did not find. Only populated when
       *  `reason === "can-actions-missing"`. */
      missing?: readonly string[];
    };

export interface ResolveCapabilityInputs {
  /** Workspace mode reported by the bridge snapshot. */
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  /** Agent the user has selected. `null` until the user picks one (or when
   *  exactly one agent is connected and the UI auto-selects it). */
  selectedAgent: string | null;
  /** Installed extensions per agent from `extensions.list`. */
  extensionsByAgent: Record<string, ExtensionEntry[]> | null;
  /** Action paths per agent from `actions.list`. */
  actionsByAgent: Record<string, string[]> | null;
  /** Latest `get_tx_state` snapshot, when available. May be `null` while the
   *  initial query is in flight; the resolver does not require it for `ready`. */
  txState: CanTransmitState | null;
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
  const canExt = extensions.find((e) => e.id === CAN_EXTENSION_ID);
  if (!canExt) {
    return { kind: "disabled", reason: "can-extension-missing", agent };
  }
  if (canExt.state !== "running") {
    return { kind: "disabled", reason: "can-extension-stopped", agent, extension: canExt };
  }
  const actions = input.actionsByAgent?.[agent] ?? [];
  const missing = REQUIRED_CAN_ACTIONS.filter((path) => !actions.includes(path));
  if (missing.length > 0) {
    return { kind: "disabled", reason: "can-actions-missing", agent, extension: canExt, missing };
  }
  return { kind: "ready", agent, extension: canExt, actions, state: input.txState };
}
