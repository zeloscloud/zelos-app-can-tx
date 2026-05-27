/** Standalone-mode mock host for `npm run dev`.
 *
 *  Wires `MockBridge.setInvokeHandler` to a small stateful CAN simulator so the
 *  app exercises every capability state without a real desktop host or agent.
 *  Covers:
 *
 *  - Mock standalone mode can render all capability states (?mock=<scenario>)
 *  - A mock raw send/start/stop flow completes with no desktop app.
 *
 *  Action paths land as `can/<bus>/<method>` to match the real agent — each
 *  simulated bus surfaces the full method set as separate paths in
 *  `actions.list`. */

import type { MockBridge } from "@zeloscloud/app-extension-sdk";

import {
  CAN_ACTION_PATH_RE,
  CAN_EXTENSION_ID,
  CAN_METHODS,
  REQUIRED_CAN_METHODS,
  type CanBusSnapshot,
  type CanBusState,
  type CanPeriodicSlot,
  type DbcCatalog,
  type SendRawParams,
  type StartPeriodicMessageParams,
  type StartPeriodicRawParams,
  type StopPeriodicParams,
} from "../lib/types";

export type MockScenario =
  | "ready"
  | "can-extension-missing"
  | "can-extension-stopped"
  | "no-ready-buses"
  | "multi-agent";

export interface MockHostOptions {
  /** Which capability state to simulate. `"multi-agent"` makes `remote:2300`
   *  ready and `localhost:2300` missing the extension. */
  scenario?: MockScenario;
}

interface SimBus {
  state: CanBusState;
  periodics: Map<string, CanPeriodicSlot>;
}

interface SimAgent {
  address: string;
  extInstalled: boolean;
  extState: "installed" | "running" | "stopped" | "failed";
  /** Whether to expose any action paths for this agent's buses. */
  exposesActions: boolean;
  buses: Map<string, SimBus>;
}

const DEMO_DBC: DbcCatalog = {
  bus: "demo",
  dbcName: "demo.dbc",
  messages: [
    {
      name: "VehicleStatus",
      canId: 0x100,
      isExtended: false,
      dlc: 8,
      cycleTimeMs: 100,
      signals: [
        { name: "Speed", startBit: 0, length: 16, byteOrder: "little", isSigned: false, scale: 0.01, offset: 0, unit: "km/h" },
        { name: "Gear", startBit: 16, length: 4, byteOrder: "little", isSigned: false, scale: 1, offset: 0, valueTable: { "0": "P", "1": "R", "2": "N", "3": "D" } },
      ],
    },
    {
      name: "BatteryState",
      canId: 0x200,
      isExtended: false,
      dlc: 8,
      cycleTimeMs: 500,
      signals: [
        { name: "SoC", startBit: 0, length: 8, byteOrder: "little", isSigned: false, scale: 1, offset: 0, unit: "%" },
        { name: "VoltagePack", startBit: 8, length: 16, byteOrder: "little", isSigned: false, scale: 0.1, offset: 0, unit: "V" },
      ],
    },
  ],
};

function buildBus(name: string): SimBus {
  return {
    state: {
      name,
      interface: "virtual",
      status: "active",
      dbc: { name: "demo.dbc", messageCount: DEMO_DBC.messages.length },
      metrics: { txErrors: 0, txOverflows: 0, messagesReceived: 0, messagesDecoded: 0, unknownMessages: 0 },
      periodics: [],
    },
    periodics: new Map(),
  };
}

function buildReadyAgent(address: string, busNames: readonly string[] = ["busA", "busB"]): SimAgent {
  return {
    address,
    extInstalled: true,
    extState: "running",
    exposesActions: true,
    buses: new Map(busNames.map((n) => [n, buildBus(n)])),
  };
}

function buildAgent(address: string, scenario: MockScenario): SimAgent {
  switch (scenario) {
    case "ready":
    case "multi-agent":
      return buildReadyAgent(address);
    case "can-extension-missing":
      return {
        address,
        extInstalled: false,
        extState: "installed",
        exposesActions: false,
        buses: new Map(),
      };
    case "can-extension-stopped":
      return { ...buildReadyAgent(address), extState: "stopped", exposesActions: false };
    case "no-ready-buses":
      // Extension is running but no buses are configured / no action paths.
      return { ...buildReadyAgent(address, []), exposesActions: false };
  }
}

function snapshot(agent: SimAgent, bus: SimBus): CanBusSnapshot {
  return {
    capturedAtUnixMs: Date.now(),
    extension: { id: CAN_EXTENSION_ID, version: "0.1.12", state: agent.extState },
    bus: { ...bus.state, periodics: [...bus.periodics.values()] },
  };
}

function taskIdFor(canIdHex: string, isExtended: boolean, mux: number | string | null | "raw"): string {
  return `${canIdHex.toLowerCase()}:${isExtended ? "ext" : "std"}:${mux}`;
}

function parseCanIdHex(canId: string): { value: number; hex: string } {
  const trimmed = canId.startsWith("0x") || canId.startsWith("0X") ? canId.slice(2) : canId;
  const value = Number.parseInt(trimmed, 16);
  if (!Number.isFinite(value) || value < 0) throw new Error(`mock: invalid can_id "${canId}"`);
  return { value, hex: `0x${value.toString(16)}` };
}

function normalizeDataHex(data: string): { hex: string; dlc: number } {
  const cleaned = data.replace(/\s+/g, "").toLowerCase();
  if (cleaned.length % 2 !== 0) throw new Error(`mock: data has odd nibble count: "${data}"`);
  return { hex: cleaned, dlc: cleaned.length / 2 };
}

/** Install the mock invoke handler. Returns a teardown function. */
export function installCanMockHost(bridge: MockBridge, opts: MockHostOptions = {}): () => void {
  const scenario: MockScenario = opts.scenario ?? "ready";
  const agents: SimAgent[] =
    scenario === "multi-agent"
      ? [buildAgent("localhost:2300", "can-extension-missing"), buildAgent("remote:2300", "ready")]
      : [buildAgent("localhost:2300", scenario)];

  const agentMap = new Map(agents.map((a) => [a.address, a]));

  bridge.setInvokeHandler(async (method, params) => {
    switch (method) {
      case "extensions.list":
        return buildExtensionsList(agentMap);
      case "actions.list":
        return buildActionsList(agentMap);
      case "actions.execute":
        return await handleActionExecute(agentMap, params);
      default:
        throw new Error(`mock-host: unknown method "${method}"`);
    }
  });

  return () => bridge.setInvokeHandler(null);
}

function buildExtensionsList(agentMap: Map<string, SimAgent>) {
  const out: Record<string, Array<{ id: string; name: string; version: string; state: string }>> = {};
  for (const [addr, a] of agentMap) {
    out[addr] = a.extInstalled
      ? [{ id: CAN_EXTENSION_ID, name: "CAN", version: "0.1.12", state: a.extState }]
      : [];
  }
  return out;
}

function buildActionsList(agentMap: Map<string, SimAgent>) {
  const out: Record<string, string[]> = {};
  for (const [addr, a] of agentMap) {
    if (!a.exposesActions) {
      out[addr] = [];
      continue;
    }
    const paths: string[] = [];
    for (const busName of a.buses.keys()) {
      for (const method of REQUIRED_CAN_METHODS) {
        paths.push(`can/${busName}/${method}`);
      }
    }
    out[addr] = paths;
  }
  return out;
}

async function handleActionExecute(agentMap: Map<string, SimAgent>, params: unknown) {
  if (params === null || typeof params !== "object") throw new Error("mock-host: bad params");
  const { agent: agentAddr, action, params: actionParams } = params as {
    agent: string;
    action: string;
    params?: unknown;
  };
  const agent = agentMap.get(agentAddr);
  if (!agent) throw new Error(`mock-host: unknown agent "${agentAddr}"`);

  const match = CAN_ACTION_PATH_RE.exec(action);
  if (!match) throw new Error(`mock-host: action path doesn't match can/<bus>/<method>: ${action}`);
  const busName = match[1]!;
  const methodName = action.slice(`can/${busName}/`.length);

  const bus = agent.buses.get(busName);
  if (!bus) throw new Error(`mock-host: unknown bus "${busName}" on agent "${agentAddr}"`);

  switch (methodName) {
    case CAN_METHODS.getTxState:
      return { status: "pass", result: snapshot(agent, bus) };
    case CAN_METHODS.listMessages:
      return { status: "pass", result: { ...DEMO_DBC, bus: busName } };
    case CAN_METHODS.sendRaw:
      return { status: "pass", result: sendRawSim(actionParams as SendRawParams) };
    case CAN_METHODS.startPeriodicRaw:
      return {
        status: "pass",
        result: startPeriodicRawSim(bus, actionParams as StartPeriodicRawParams),
      };
    case CAN_METHODS.sendMessage:
      return { status: "pass", result: null };
    case CAN_METHODS.startPeriodicMessage:
      return {
        status: "pass",
        result: startPeriodicMessageSim(bus, actionParams as StartPeriodicMessageParams),
      };
    case CAN_METHODS.stopPeriodic:
      return { status: "pass", result: stopPeriodicSim(bus, actionParams as StopPeriodicParams) };
    default:
      throw new Error(`mock-host: unknown method "${methodName}"`);
  }
}

function sendRawSim(params: SendRawParams) {
  const id = parseCanIdHex(params.canId);
  const { hex, dlc } = normalizeDataHex(params.data);
  return { canId: id.value, canIdHex: id.hex, dlc, dataHex: hex };
}

function startPeriodicRawSim(bus: SimBus, params: StartPeriodicRawParams) {
  const id = parseCanIdHex(params.canId);
  const { hex, dlc } = normalizeDataHex(params.data);
  const taskId = taskIdFor(id.hex, params.isExtended ?? false, "raw");
  const replaced = bus.periodics.has(taskId);
  bus.periodics.set(taskId, {
    taskId,
    canId: id.value,
    isExtended: params.isExtended ?? false,
    isFd: params.isFd ?? false,
    dlc,
    dataHex: hex,
    periodMs: params.periodMs,
    mode: "raw",
    isActive: true,
  });
  return { task_id: taskId, replaced };
}

function startPeriodicMessageSim(bus: SimBus, params: StartPeriodicMessageParams) {
  const msg = DEMO_DBC.messages.find((m) => m.name === params.message);
  if (!msg) throw new Error(`mock-host: unknown DBC message "${params.message}"`);
  const mux = params.mux ?? null;
  const taskId = taskIdFor(`0x${msg.canId.toString(16)}`, msg.isExtended, mux ?? "dbc");
  const replaced = bus.periodics.has(taskId);
  bus.periodics.set(taskId, {
    taskId,
    canId: msg.canId,
    isExtended: msg.isExtended,
    isFd: false,
    dlc: msg.dlc,
    dataHex: "".padStart(msg.dlc * 2, "0"),
    periodMs: params.periodMs,
    mode: "dbc",
    isActive: true,
    message: { name: msg.name, mux, signals: params.signals },
  });
  return { task_id: taskId, replaced };
}

function stopPeriodicSim(bus: SimBus, params: StopPeriodicParams) {
  const existed = bus.periodics.delete(params.taskId);
  return { task_id: params.taskId, stopped: existed };
}
