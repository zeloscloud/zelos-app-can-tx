import type { ExtensionEntry } from "@zeloscloud/app-extension-sdk";
import { describe, expect, it } from "vitest";
import { discoverCanTx, resolveAgentStatus, type DiscoverInputs } from "./capability";
import {
  canActionPath,
  CAN_EXTENSION_ID,
  REQUIRED_CAN_METHODS,
  resolveCanActionPrefix,
} from "./types";

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

function allRequiredActionPaths(prefix = "CAN"): string[] {
  return REQUIRED_CAN_METHODS.map((m) => canActionPath(m, prefix));
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
    const incomplete = [
      canActionPath("get_tx_state", "CAN"),
      canActionPath("list_messages", "CAN"),
    ];
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

  it("picks the running install over a stopped sibling, so Stop targets the transmitter", () => {
    const status = resolveAgentStatus(
      "a:1",
      [{ ...localInstallCanExt, state: "stopped" }, runningCanExt],
      allRequiredActionPaths(),
      ["busA"],
    );
    expect(status.kind).toBe("ready");
    expect(status.extension).toBe(runningCanExt);
    expect(status.ambiguousInstalls).toBeUndefined();
  });

  it("names both installs when two are running, in either listed order", () => {
    const dual = [...allRequiredActionPaths("can"), ...allRequiredActionPaths("CAN")];
    for (const exts of [
      [runningCanExt, localInstallCanExt],
      [localInstallCanExt, runningCanExt],
    ]) {
      const status = resolveAgentStatus("a:1", exts, dual, ["busA"]);
      expect(status.kind).toBe("ready");
      expect(status.extension?.id).toBe("local.can");
      expect(status.ambiguousInstalls?.map((e) => e.id)).toEqual(["local.can", CAN_EXTENSION_ID]);
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

describe("action namespace discovery", () => {
  it("resolves whichever namespace the agent serves", () => {
    expect(resolveCanActionPrefix(allRequiredActionPaths("CAN"))).toBe("CAN");
    expect(resolveCanActionPrefix(allRequiredActionPaths("can"))).toBe("can");
  });

  it("resolves from a partial surface, so a wrong-version extension is still identified", () => {
    // The tab then names the missing methods instead of reporting no CAN extension.
    const partial = [canActionPath("get_tx_state", "CAN"), canActionPath("send_raw", "CAN")];
    expect(resolveCanActionPrefix(partial)).toBe("CAN");
  });

  it("prefers the namespace serving the discovery action over a fuller stranger", () => {
    const midRegistration = [
      canActionPath("list_codecs", "CAN"),
      canActionPath("get_tx_state", "CAN"),
      "serial/send_raw",
      "serial/send_message",
      "serial/list_messages",
    ];
    expect(resolveCanActionPrefix(midRegistration)).toBe("CAN");
  });

  it("rejects a nested namespace rather than aiming a frame under the wrong bus", () => {
    const perBus = [
      "CAN/can0/list_codecs",
      "CAN/can0/send_raw",
      "CAN/can1/list_codecs",
      "CAN/can1/send_raw",
    ];
    expect(resolveCanActionPrefix(perBus)).toBeNull();
  });

  it("ignores paths that are not CAN actions at all", () => {
    expect(resolveCanActionPrefix(["unrelated/thing"])).toBeNull();
    expect(resolveCanActionPrefix(["list_codecs"])).toBeNull();
    expect(resolveCanActionPrefix(["/list_codecs"])).toBeNull();
    expect(resolveCanActionPrefix([])).toBeNull();
  });

  it("is deterministic when one agent serves two namespaces", () => {
    const mixed = [...allRequiredActionPaths("CAN"), canActionPath("list_codecs", "zz-other")];
    expect(resolveCanActionPrefix(mixed)).toBe("CAN");
    expect(resolveCanActionPrefix([...mixed].reverse())).toBe("CAN");
  });

  it("is stable in both orders when two namespaces both serve the full surface", () => {
    const dual = [...allRequiredActionPaths("can"), ...allRequiredActionPaths("CAN")];
    expect(resolveCanActionPrefix(dual)).toBe("can");
    expect(resolveCanActionPrefix([...dual].reverse())).toBe("can");
  });

  it("carries the resolved namespace on the ready status", () => {
    const lowercase = resolveAgentStatus("a:1", [runningCanExt], allRequiredActionPaths("can"), [
      "bus0",
    ]);
    expect(lowercase.kind).toBe("ready");
    expect(lowercase.actionPrefix).toBe("can");

    const current = resolveAgentStatus("a:1", [runningCanExt], allRequiredActionPaths("CAN"), [
      "bus0",
    ]);
    expect(current.kind).toBe("ready");
    expect(current.actionPrefix).toBe("CAN");
  });

  it("reports every method missing when no namespace serves CAN at all", () => {
    const status = resolveAgentStatus("a:1", [runningCanExt], ["unrelated/thing"], ["bus0"]);
    expect(status.kind).toBe("no-ready-buses");
    if (status.kind === "no-ready-buses") {
      expect(status.missingMethods).toEqual([...REQUIRED_CAN_METHODS]);
    }
  });
});
