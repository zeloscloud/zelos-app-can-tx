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
 *  `actions.list`. All wire fields are snake_case (mirroring the Python
 *  codec's idiom). */

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

interface MockDbcParams {
  message: string;
  signals_json: string;
  period_ms: number;
  mux?: string;
}

const DEMO_DBC: DbcCatalog = {
  bus: "demo",
  dbc_name: "demo.dbc",
  messages: [
    {
      name: "VehicleStatus",
      can_id: 0x100,
      is_extended: false,
      dlc: 8,
      cycle_time_ms: 100,
      signals: [
        { name: "Speed", start_bit: 0, length: 16, byte_order: "little", is_signed: false, scale: 0.01, offset: 0, unit: "km/h" },
        { name: "Gear", start_bit: 16, length: 4, byte_order: "little", is_signed: false, scale: 1, offset: 0, value_table: { "0": "P", "1": "R", "2": "N", "3": "D" } },
      ],
    },
    {
      name: "BatteryState",
      can_id: 0x200,
      is_extended: false,
      dlc: 8,
      cycle_time_ms: 500,
      signals: [
        { name: "SoC", start_bit: 0, length: 8, byte_order: "little", is_signed: false, scale: 1, offset: 0, unit: "%" },
        { name: "VoltagePack", start_bit: 8, length: 16, byte_order: "little", is_signed: false, scale: 0.1, offset: 0, unit: "V" },
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
      dbc: { name: "demo.dbc", message_count: DEMO_DBC.messages.length },
      metrics: {
        tx_errors: 0,
        tx_overflows: 0,
        messages_received: 0,
        messages_decoded: 0,
        unknown_messages: 0,
      },
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
    captured_at_unix_ms: Date.now(),
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
        result: startPeriodicMessageSim(bus, actionParams as MockDbcParams),
      };
    case CAN_METHODS.stopPeriodic:
      return { status: "pass", result: stopPeriodicSim(bus, actionParams as StopPeriodicParams) };
    default:
      throw new Error(`mock-host: unknown method "${methodName}"`);
  }
}

function sendRawSim(params: SendRawParams) {
  const id = parseCanIdHex(params.can_id);
  const { hex, dlc } = normalizeDataHex(params.data);
  return { can_id: id.value, can_id_hex: id.hex, dlc, data_hex: hex };
}

function startPeriodicRawSim(bus: SimBus, params: StartPeriodicRawParams) {
  const id = parseCanIdHex(params.can_id);
  const { hex, dlc } = normalizeDataHex(params.data);
  const task_id = taskIdFor(id.hex, params.is_extended ?? false, "raw");
  const replaced = bus.periodics.has(task_id);
  bus.periodics.set(task_id, {
    task_id,
    can_id: id.value,
    is_extended: params.is_extended ?? false,
    is_fd: params.is_fd ?? false,
    dlc,
    data_hex: hex,
    period_ms: params.period_ms,
    mode: "raw",
    is_active: true,
  });
  return { task_id, replaced };
}

function startPeriodicMessageSim(bus: SimBus, params: MockDbcParams) {
  const msg = DEMO_DBC.messages.find((m) => m.name === params.message);
  if (!msg) throw new Error(`mock-host: unknown DBC message "${params.message}"`);
  const mux = params.mux ?? null;
  const task_id = taskIdFor(`0x${msg.can_id.toString(16)}`, msg.is_extended, mux ?? "dbc");
  const replaced = bus.periodics.has(task_id);
  bus.periodics.set(task_id, {
    task_id,
    can_id: msg.can_id,
    is_extended: msg.is_extended,
    is_fd: false,
    dlc: msg.dlc,
    data_hex: "".padStart(msg.dlc * 2, "0"),
    period_ms: params.period_ms,
    mode: "dbc",
    is_active: true,
    message: { name: msg.name, mux, signals: JSON.parse(params.signals_json) as Record<string, unknown> },
  });
  return { task_id, replaced };
}

function stopPeriodicSim(bus: SimBus, params: StopPeriodicParams) {
  const existed = bus.periodics.delete(params.task_id);
  return { task_id: params.task_id, stopped: existed };
}
