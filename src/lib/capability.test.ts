/** Capability resolver: `ready` (with one or more ready buses) vs `disabled`
 *  reasons. Resolver is a pure function so tests assert one fixture per reason
 *  without spinning up React. Each case maps to a fixture state the mock host
 *  also surfaces, so the UI and tests draw from the same vocabulary. */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";
import { describe, expect, it } from "vitest";
import { resolveCanTxCapability, type ResolveCapabilityInputs } from "./capability";
import { canActionPath, CAN_EXTENSION_ID, REQUIRED_CAN_METHODS } from "./types";

const runningCanExt: ExtensionEntry = {
  id: CAN_EXTENSION_ID,
  name: "CAN",
  version: "0.1.12",
  state: "running",
};

const stoppedCanExt: ExtensionEntry = { ...runningCanExt, state: "stopped" };

/** Build the full `can/<bus>/<method>` path set for the given buses. */
function pathsForBuses(...buses: string[]): string[] {
  return buses.flatMap((bus) => REQUIRED_CAN_METHODS.map((m) => canActionPath(bus, m)));
}

function base(overrides: Partial<ResolveCapabilityInputs>): ResolveCapabilityInputs {
  return {
    workspaceModeKind: "LIVE",
    selectedAgent: "localhost:2300",
    extensionsByAgent: { "localhost:2300": [runningCanExt] },
    actionsByAgent: { "localhost:2300": pathsForBuses("busA") },
    ...overrides,
  };
}

describe("resolveCanTxCapability", () => {
  it("returns ready with one bus when a single bus has the full method set", () => {
    const cap = resolveCanTxCapability(base({}));
    expect(cap.kind).toBe("ready");
    if (cap.kind === "ready") {
      expect(cap.agent).toBe("localhost:2300");
      expect(cap.extension).toBe(runningCanExt);
      expect(cap.buses.map((b) => b.name)).toEqual(["busA"]);
    }
  });

  it("returns ready with every bus that has its full method set", () => {
    const cap = resolveCanTxCapability(
      base({ actionsByAgent: { "localhost:2300": pathsForBuses("busA", "busB") } }),
    );
    expect(cap.kind).toBe("ready");
    if (cap.kind === "ready") expect(cap.buses.map((b) => b.name)).toEqual(["busA", "busB"]);
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
    const cap = resolveCanTxCapability(base({ extensionsByAgent: { "localhost:2300": [] } }));
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

  it("disabled: no-ready-buses when no bus has the full method set, with per-bus missing lists", () => {
    // Bus has only a few methods present
    const incomplete = [
      canActionPath("busA", "get_tx_state"),
      canActionPath("busA", "list_messages"),
    ];
    const cap = resolveCanTxCapability(base({ actionsByAgent: { "localhost:2300": incomplete } }));
    expect(cap.kind).toBe("disabled");
    if (cap.kind === "disabled") {
      expect(cap.reason).toBe("no-ready-buses");
      expect(cap.partialBuses).toEqual([
        {
          name: "busA",
          missing: REQUIRED_CAN_METHODS.filter(
            (m) => m !== "get_tx_state" && m !== "list_messages",
          ),
        },
      ]);
    }
  });

  it("disabled: no-ready-buses with empty partialBuses when no CAN actions are visible at all", () => {
    const cap = resolveCanTxCapability(base({ actionsByAgent: { "localhost:2300": [] } }));
    expect(cap).toMatchObject({ kind: "disabled", reason: "no-ready-buses", partialBuses: [] });
  });
});
