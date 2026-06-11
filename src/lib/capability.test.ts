/** Discovery + per-agent capability — pure-function tests. */

import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";
import { describe, expect, it } from "vitest";
import { discoverCanTx, resolveAgentStatus, statusLabel, type DiscoverInputs } from "./capability";
import { canActionPath, CAN_EXTENSION_ID, REQUIRED_CAN_METHODS } from "./types";

const runningCanExt: ExtensionEntry = {
  id: CAN_EXTENSION_ID,
  name: "CAN",
  version: "0.1.12",
  state: "running",
};

const localInstallCanExt: ExtensionEntry = {
  id: "local.can",
  name: "CAN",
  version: "0.1.12",
  state: "running",
};

const stoppedCanExt: ExtensionEntry = { ...runningCanExt, state: "stopped" };

/** The full set of action paths a healthy CAN extension registers. */
function allRequiredActionPaths(): string[] {
  return REQUIRED_CAN_METHODS.map((m) => canActionPath(m));
}

function baseDiscoveryInput(overrides: Partial<DiscoverInputs> = {}): DiscoverInputs {
  return {
    workspaceModeKind: "LIVE",
    extensionsByAgent: { "localhost:2300": [runningCanExt] },
    actionsByAgent: { "localhost:2300": allRequiredActionPaths() },
    codecsByAgent: { "localhost:2300": ["busA"] },
    ...overrides,
  };
}

// ─── Per-agent resolver ─────────────────────────────────────────────────────

describe("resolveAgentStatus", () => {
  it("returns ready when extension is running, actions are registered, and list_codecs reports at least one bus", () => {
    const status = resolveAgentStatus("localhost:2300", [runningCanExt], allRequiredActionPaths(), [
      "busA",
    ]);
    expect(status.kind).toBe("ready");
    if (status.kind === "ready") {
      expect(status.extension).toBe(runningCanExt);
      expect(status.buses?.map((b) => b.name)).toEqual(["busA"]);
    }
  });

  it("recognizes a local-install ID (local.can) as the CAN extension", () => {
    const status = resolveAgentStatus(
      "localhost:2300",
      [localInstallCanExt],
      allRequiredActionPaths(),
      ["busA"],
    );
    expect(status.kind).toBe("ready");
    if (status.kind === "ready") expect(status.extension).toBe(localInstallCanExt);
  });

  it("returns extension-missing when no CAN extension is installed", () => {
    expect(resolveAgentStatus("a:1", [], [], undefined)).toEqual({
      agent: "a:1",
      kind: "extension-missing",
    });
  });

  it("returns extension-stopped when the CAN extension exists but is not running", () => {
    const status = resolveAgentStatus("a:1", [stoppedCanExt], [], undefined);
    expect(status).toMatchObject({
      agent: "a:1",
      kind: "extension-stopped",
      extension: stoppedCanExt,
    });
  });

  it("returns no-ready-buses with missingMethods detail when required actions are missing", () => {
    const incomplete = [canActionPath("get_tx_state"), canActionPath("list_messages")];
    const status = resolveAgentStatus("a:1", [runningCanExt], incomplete, undefined);
    expect(status.kind).toBe("no-ready-buses");
    if (status.kind === "no-ready-buses") {
      expect(status.missingMethods).toEqual(
        REQUIRED_CAN_METHODS.filter((m) => m !== "get_tx_state" && m !== "list_messages"),
      );
    }
  });

  it("returns discovering-codecs when extension + actions are healthy but list_codecs hasn't resolved", () => {
    const status = resolveAgentStatus("a:1", [runningCanExt], allRequiredActionPaths(), undefined);
    expect(status.kind).toBe("discovering-codecs");
  });

  it("returns no-ready-buses (no missingMethods) when list_codecs resolves to zero codecs", () => {
    const status = resolveAgentStatus("a:1", [runningCanExt], allRequiredActionPaths(), []);
    expect(status.kind).toBe("no-ready-buses");
    if (status.kind === "no-ready-buses") {
      expect(status.missingMethods).toBeUndefined();
    }
  });

  it("returns multiple ready buses when list_codecs reports more than one codec", () => {
    const status = resolveAgentStatus("a:1", [runningCanExt], allRequiredActionPaths(), [
      "busA",
      "busB",
    ]);
    expect(status.kind).toBe("ready");
    if (status.kind === "ready") {
      expect(status.buses?.map((b) => b.name)).toEqual(["busA", "busB"]);
    }
  });
});

// ─── Discovery (top-level) ──────────────────────────────────────────────────

describe("discoverCanTx", () => {
  it("returns ready with one agent when the only connected agent is ready", () => {
    const disc = discoverCanTx(baseDiscoveryInput());
    expect(disc.kind).toBe("ready");
    if (disc.kind === "ready") {
      expect(disc.agents.map((a) => a.agent)).toEqual(["localhost:2300"]);
      expect(disc.agents[0]?.kind).toBe("ready");
    }
  });

  it("returns ready with multiple agents (mixed statuses), sorted by address", () => {
    const disc = discoverCanTx(
      baseDiscoveryInput({
        extensionsByAgent: {
          "localhost:2300": [runningCanExt],
          "remote:2300": [],
        },
        actionsByAgent: {
          "localhost:2300": allRequiredActionPaths(),
          "remote:2300": [],
        },
        codecsByAgent: { "localhost:2300": ["busA"] },
      }),
    );
    expect(disc.kind).toBe("ready");
    if (disc.kind === "ready") {
      expect(disc.agents.map((a) => ({ a: a.agent, k: a.kind }))).toEqual([
        { a: "localhost:2300", k: "ready" },
        { a: "remote:2300", k: "extension-missing" },
      ]);
    }
  });

  it("unions agent keys across both fan-outs (either source can be first)", () => {
    const disc = discoverCanTx(
      baseDiscoveryInput({
        extensionsByAgent: { "localhost:2300": [runningCanExt], "remote:2300": [stoppedCanExt] },
        actionsByAgent: { "localhost:2300": allRequiredActionPaths(), "alt:2300": [] },
        codecsByAgent: { "localhost:2300": ["busA"] },
      }),
    );
    expect(disc.kind).toBe("ready");
    if (disc.kind === "ready") {
      expect(disc.agents.map((a) => a.agent)).toEqual([
        "alt:2300",
        "localhost:2300",
        "remote:2300",
      ]);
    }
  });

  it("disabled: not-live when workspace mode is not LIVE", () => {
    for (const mode of ["NONE", "TRACE", "TRACEPATH"] as const) {
      const disc = discoverCanTx(baseDiscoveryInput({ workspaceModeKind: mode }));
      expect(disc).toEqual({ kind: "disabled", reason: "not-live" });
    }
  });

  it("disabled: no-agents-connected when no agents are present in either fan-out", () => {
    const disc = discoverCanTx(
      baseDiscoveryInput({ extensionsByAgent: {}, actionsByAgent: {}, codecsByAgent: {} }),
    );
    expect(disc).toEqual({ kind: "disabled", reason: "no-agents-connected" });
  });

  it("treats null fan-outs as in-flight (no agents yet, so no-agents-connected)", () => {
    const disc = discoverCanTx(
      baseDiscoveryInput({
        extensionsByAgent: null,
        actionsByAgent: null,
        codecsByAgent: null,
      }),
    );
    expect(disc).toEqual({ kind: "disabled", reason: "no-agents-connected" });
  });
});

// ─── statusLabel ────────────────────────────────────────────────────────────

describe("statusLabel", () => {
  it("renders bus count for ready agents", () => {
    expect(statusLabel({ agent: "a", kind: "ready", buses: [{ name: "b1" }] })).toBe(
      "ready (1 bus)",
    );
    expect(
      statusLabel({
        agent: "a",
        kind: "ready",
        buses: [{ name: "b1" }, { name: "b2" }],
      }),
    ).toBe("ready (2 buses)");
  });

  it("renders disabled reasons", () => {
    expect(statusLabel({ agent: "a", kind: "extension-missing" })).toBe(
      "CAN extension not installed",
    );
    expect(statusLabel({ agent: "a", kind: "extension-stopped", extension: stoppedCanExt })).toBe(
      "CAN extension stopped",
    );
    expect(statusLabel({ agent: "a", kind: "no-ready-buses" })).toBe("no buses configured");
    expect(
      statusLabel({
        agent: "a",
        kind: "no-ready-buses",
        missingMethods: ["send_message"],
      }),
    ).toBe("missing actions: send_message");
    expect(statusLabel({ agent: "a", kind: "discovering-codecs" })).toBe("discovering buses…");
  });
});
