/** T14 (CAN_TRANSMIT.md §7.1): capability resolver `ready` vs `disabled` reasons.
 *
 *  Resolver is a pure function so tests assert one fixture per reason without
 *  spinning up React. Each case below maps to a fixture state the mock host
 *  also surfaces, so the UI and tests draw from the same vocabulary. */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";
import { describe, expect, it } from "vitest";
import { resolveCanTxCapability, type ResolveCapabilityInputs } from "./capability";
import { CAN_ACTIONS, CAN_EXTENSION_ID, REQUIRED_CAN_ACTIONS } from "./types";

const runningCanExt: ExtensionEntry = {
  id: CAN_EXTENSION_ID,
  name: "CAN",
  version: "0.1.12",
  state: "running",
};

const stoppedCanExt: ExtensionEntry = { ...runningCanExt, state: "stopped" };

function base(overrides: Partial<ResolveCapabilityInputs>): ResolveCapabilityInputs {
  return {
    workspaceModeKind: "LIVE",
    selectedAgent: "localhost:2300",
    extensionsByAgent: { "localhost:2300": [runningCanExt] },
    actionsByAgent: { "localhost:2300": [...REQUIRED_CAN_ACTIONS] },
    txState: null,
    ...overrides,
  };
}

describe("resolveCanTxCapability", () => {
  it("returns ready when all preconditions are satisfied", () => {
    const cap = resolveCanTxCapability(base({}));
    expect(cap.kind).toBe("ready");
    if (cap.kind === "ready") {
      expect(cap.agent).toBe("localhost:2300");
      expect(cap.extension).toBe(runningCanExt);
      expect(cap.actions).toEqual(REQUIRED_CAN_ACTIONS);
    }
  });

  it("disabled: not-live when workspace is not LIVE", () => {
    for (const mode of ["NONE", "TRACE", "TRACEPATH"] as const) {
      const cap = resolveCanTxCapability(base({ workspaceModeKind: mode }));
      expect(cap).toEqual({ kind: "disabled", reason: "not-live" });
    }
  });

  it("disabled: no-agent when no agent is selected", () => {
    const cap = resolveCanTxCapability(base({ selectedAgent: null }));
    expect(cap).toEqual({ kind: "disabled", reason: "no-agent" });
  });

  it("disabled: can-extension-missing when the CAN extension is not installed", () => {
    const cap = resolveCanTxCapability(
      base({ extensionsByAgent: { "localhost:2300": [] } }),
    );
    expect(cap).toEqual({ kind: "disabled", reason: "can-extension-missing", agent: "localhost:2300" });
  });

  it("disabled: can-extension-stopped when the CAN extension is installed but not running", () => {
    const cap = resolveCanTxCapability(
      base({ extensionsByAgent: { "localhost:2300": [stoppedCanExt] } }),
    );
    expect(cap).toMatchObject({
      kind: "disabled",
      reason: "can-extension-stopped",
      agent: "localhost:2300",
      extension: stoppedCanExt,
    });
  });

  it("disabled: can-actions-missing with the list of missing paths", () => {
    const cap = resolveCanTxCapability(
      base({ actionsByAgent: { "localhost:2300": [CAN_ACTIONS.getTxState] } }),
    );
    expect(cap.kind).toBe("disabled");
    if (cap.kind === "disabled") {
      expect(cap.reason).toBe("can-actions-missing");
      expect(cap.missing).toEqual(
        REQUIRED_CAN_ACTIONS.filter((p) => p !== CAN_ACTIONS.getTxState),
      );
    }
  });

  it("ready: passes through the latest txState snapshot when provided", () => {
    const snapshot = {
      capturedAtUnixMs: 1_700_000_000_000,
      extension: { id: CAN_EXTENSION_ID, version: "0.1.12", state: "running" },
      buses: [],
    };
    const cap = resolveCanTxCapability(base({ txState: snapshot }));
    expect(cap.kind).toBe("ready");
    if (cap.kind === "ready") expect(cap.state).toBe(snapshot);
  });
});
