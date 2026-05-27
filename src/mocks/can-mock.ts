/** Standalone-mode mock host for `npm run dev`.
 *
 *  Wires `MockBridge.setInvokeHandler` to a small stateful CAN simulator so the
 *  app exercises every capability state without a real desktop host or agent.
 *  Covers Phase 5 exit gates:
 *
 *  - Mock standalone mode can render all capability states.
 *  - A mock raw send/start/stop flow completes with no desktop app.
 *
 *  The simulator is intentionally minimal: in-memory periodics keyed by taskId,
 *  no real timers, no DBC encoding (preview returns the same hex it was given).
 *  Extend per state as the app grows. */

import type { MockBridge } from "@zeloscloud/app-extension-sdk";

import { CAN_ACTIONS, CAN_EXTENSION_ID } from "../lib/types";
import type {
  CanBusTxState,
  CanPeriodicSlot,
  CanTransmitState,
  DbcCatalog,
  SendRawParams,
  StartPeriodicMessageParams,
  StartPeriodicRawParams,
  StopPeriodicParams,
} from "../lib/types";

export type MockScenario =
  | "ready"
  | "can-extension-missing"
  | "can-extension-stopped"
  | "can-actions-missing"
  | "multi-agent";

export interface MockHostOptions {
  /** Which capability state to simulate. `"multi-agent"` makes `remote:2300`
   *  ready and `localhost:2300` missing the extension, exercising agent
   *  selection logic. */
  scenario?: MockScenario;
}

interface SimAgent {
  address: string;
  extInstalled: boolean;
  extState: "installed" | "running" | "stopped" | "failed";
  exposesActions: boolean;
  buses: CanBusTxState[];
  periodics: Map<string, CanPeriodicSlot>;
}

const DEMO_DBC: DbcCatalog = {
  bus: "demo",
  dbcName: "demo.dbc",
  dbcHash: "deadbeef",
  messages: [
    {
      name: "VehicleStatus",
      canId: 0x100,
      isExtended: false,
      dlc: 8,
      cycleTimeMs: 100,
      signals: [
        { name: "Speed", startBit: 0, length: 16, byteOrder: "little", isSigned: false, scale: 0.01, offset: 0, unit: "km/h" },
        { name: "Gear", startBit: 16, length: 4, byteOrder: "little", isSigned: false, scale: 1, offset: 0, valueTable: { 0: "P", 1: "R", 2: "N", 3: "D" } },
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

function buildReadyAgent(address: string): SimAgent {
  return {
    address,
    extInstalled: true,
    extState: "running",
    exposesActions: true,
    buses: [
      {
        name: "demo",
        interface: "virtual",
        status: "active",
        dbc: { name: "demo.dbc", hash: "deadbeef", messageCount: DEMO_DBC.messages.length },
        metrics: { txErrors: 0, txOverflows: 0, messagesReceived: 0, messagesDecoded: 0, unknownMessages: 0 },
        periodics: [],
      },
    ],
    periodics: new Map(),
  };
}

function buildAgent(address: string, scenario: MockScenario): SimAgent {
  switch (scenario) {
    case "ready":
    case "multi-agent":
      return buildReadyAgent(address);
    case "can-extension-missing":
      return { address, extInstalled: false, extState: "installed", exposesActions: false, buses: [], periodics: new Map() };
    case "can-extension-stopped":
      return { ...buildReadyAgent(address), extState: "stopped", exposesActions: false };
    case "can-actions-missing":
      return { ...buildReadyAgent(address), exposesActions: false };
  }
}

const ALL_CAN_ACTION_PATHS = Object.values(CAN_ACTIONS);

function buildSnapshot(agent: SimAgent): CanTransmitState {
  return {
    capturedAtUnixMs: Date.now(),
    extension: { id: CAN_EXTENSION_ID, version: "0.1.12", state: agent.extState },
    buses: agent.buses.map((b) => ({ ...b, periodics: [...agent.periodics.values()].filter((p) => p.bus === b.name) })),
  };
}

function taskIdFor(bus: string, canIdHex: string, isExtended: boolean, mux: number | string | null | "raw"): string {
  return `${bus}:${canIdHex.toLowerCase()}:${isExtended ? "ext" : "std"}:${mux}`;
}

function parseCanIdHex(canId: string): { value: number; hex: string } {
  const trimmed = canId.startsWith("0x") || canId.startsWith("0X") ? canId.slice(2) : canId;
  const value = Number.parseInt(trimmed, 16);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`mock: invalid can_id "${canId}"`);
  }
  return { value, hex: `0x${value.toString(16)}` };
}

function normalizeDataHex(data: string): { hex: string; dlc: number } {
  const cleaned = data.replace(/\s+/g, "").toLowerCase();
  if (cleaned.length % 2 !== 0) throw new Error(`mock: data has odd nibble count: "${data}"`);
  const dlc = cleaned.length / 2;
  return { hex: cleaned.match(/.{1,2}/g)?.join(" ") ?? "", dlc };
}

/** Install the mock invoke handler. Returns a teardown function. */
export function installCanMockHost(bridge: MockBridge, opts: MockHostOptions = {}): () => void {
  const scenario: MockScenario = opts.scenario ?? "ready";
  const agents: SimAgent[] =
    scenario === "multi-agent"
      ? [
          { ...buildAgent("localhost:2300", "can-extension-missing") },
          { ...buildAgent("remote:2300", "ready") },
        ]
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
    out[addr] = a.exposesActions ? [...ALL_CAN_ACTION_PATHS] : [];
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

  switch (action) {
    case CAN_ACTIONS.getTxState:
      return { status: "pass", result: buildSnapshot(agent) };
    case CAN_ACTIONS.listMessages:
      return { status: "pass", result: DEMO_DBC };
    case CAN_ACTIONS.sendRaw:
      return { status: "pass", result: sendRawSim(actionParams as SendRawParams) };
    case CAN_ACTIONS.startPeriodicRaw:
      return { status: "pass", result: startPeriodicRawSim(agent, actionParams as StartPeriodicRawParams) };
    case CAN_ACTIONS.sendMessage:
      return { status: "pass", result: null };
    case CAN_ACTIONS.startPeriodicMessage:
      return {
        status: "pass",
        result: startPeriodicMessageSim(agent, actionParams as StartPeriodicMessageParams),
      };
    case CAN_ACTIONS.stopPeriodic:
      return { status: "pass", result: stopPeriodicSim(agent, actionParams as StopPeriodicParams) };
    default:
      throw new Error(`mock-host: unknown action "${action}"`);
  }
}

function sendRawSim(params: SendRawParams) {
  const id = parseCanIdHex(params.canId);
  const { hex, dlc } = normalizeDataHex(params.data);
  return { bus: params.bus, canId: id.value, canIdHex: id.hex, dlc, dataHex: hex };
}

function startPeriodicRawSim(agent: SimAgent, params: StartPeriodicRawParams) {
  const id = parseCanIdHex(params.canId);
  const { hex, dlc } = normalizeDataHex(params.data);
  const taskId = taskIdFor(params.bus, id.hex, params.isExtended ?? false, "raw");
  const replaced = agent.periodics.has(taskId);
  agent.periodics.set(taskId, {
    taskId,
    bus: params.bus,
    canId: id.value,
    isExtended: params.isExtended ?? false,
    isFd: params.isFd ?? false,
    dlc,
    dataHex: hex,
    periodMs: params.periodMs,
    mode: "raw",
    isActive: true,
  });
  return { taskId, replaced };
}

function startPeriodicMessageSim(agent: SimAgent, params: StartPeriodicMessageParams) {
  const msg = DEMO_DBC.messages.find((m) => m.name === params.message);
  if (!msg) throw new Error(`mock-host: unknown DBC message "${params.message}"`);
  const mux = params.mux ?? null;
  const taskId = taskIdFor(params.bus, `0x${msg.canId.toString(16)}`, msg.isExtended, mux ?? "dbc");
  const replaced = agent.periodics.has(taskId);
  agent.periodics.set(taskId, {
    taskId,
    bus: params.bus,
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
  return { taskId, replaced };
}

function stopPeriodicSim(agent: SimAgent, params: StopPeriodicParams) {
  const existed = agent.periodics.delete(params.taskId);
  return { taskId: params.taskId, stopped: existed };
}
