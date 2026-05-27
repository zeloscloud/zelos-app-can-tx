/** Wire shapes shared by the bridge wrapper, mock host, and capability resolver.
 *
 *  Kept hand-maintained — the agent extension does not yet emit ts-rs bindings
 *  for these shapes. Until it does, the app fixtures and the agent serializer
 *  must stay in lock-step here. */

/** CAN agent extension ID this app pins to in the manifest `requires` block.
 *  The agent reports this same ID in `get_tx_state.extension.id`. */
export const CAN_EXTENSION_ID = "zeloscloud.zelos-extension-can";

/** Bare method names exposed by the CAN extension. Each registered bus surfaces
 *  these as `can/<bus>/<method>` on the agent. Use {@link canActionPath} to
 *  build a full path. */
export const CAN_METHODS = {
  getTxState: "get_tx_state",
  listMessages: "list_messages",
  sendRaw: "send_raw",
  startPeriodicRaw: "start_periodic_raw",
  sendMessage: "send_message",
  startPeriodicMessage: "start_periodic_message",
  stopPeriodic: "stop_periodic",
} as const;

export type CanMethodName = (typeof CAN_METHODS)[keyof typeof CAN_METHODS];

/** Method names every CAN bus must register before the app considers it ready. */
export const REQUIRED_CAN_METHODS: readonly CanMethodName[] = [
  CAN_METHODS.getTxState,
  CAN_METHODS.listMessages,
  CAN_METHODS.sendRaw,
  CAN_METHODS.startPeriodicRaw,
  CAN_METHODS.sendMessage,
  CAN_METHODS.startPeriodicMessage,
  CAN_METHODS.stopPeriodic,
];

/** Build the full action path for a given bus + method. */
export function canActionPath(bus: string, method: CanMethodName | string): string {
  return `can/${bus}/${method}`;
}

/** Pattern matching `can/<bus>/<method>`. Capture group 1 is the bus name. */
export const CAN_ACTION_PATH_RE = /^can\/([^/]+)\/[^/]+$/;

/** Extract the unique set of bus names from a list of action paths. */
export function extractBusNames(actionPaths: readonly string[]): string[] {
  const buses = new Set<string>();
  for (const path of actionPaths) {
    const match = CAN_ACTION_PATH_RE.exec(path);
    if (match?.[1]) buses.add(match[1]);
  }
  return [...buses].sort();
}

// ─── Bus snapshot shapes ────────────────────────────────────────────────────

export interface CanBusMetrics {
  txErrors?: number;
  txOverflows?: number;
  messagesReceived?: number;
  messagesDecoded?: number;
  unknownMessages?: number;
}

export interface CanBusDbcMetadata {
  path?: string;
  name?: string;
  hash?: string;
  messageCount?: number;
}

export interface CanPeriodicSlot {
  taskId: string;
  canId: number;
  isExtended: boolean;
  isFd: boolean;
  dlc: number;
  dataHex: string;
  periodMs: number;
  mode: "raw" | "dbc";
  isActive: boolean;
  message?: {
    name: string;
    mux?: number | string | null;
    signals?: Record<string, unknown>;
  };
  lastError?: string | null;
}

export interface CanBusState {
  name: string;
  interface: string;
  channel?: string;
  status: "active" | "stopped" | "error" | "unknown";
  dbc?: CanBusDbcMetadata;
  metrics?: CanBusMetrics;
  periodics: CanPeriodicSlot[];
  lastError?: string | null;
}

/** What `can/<bus>/get_tx_state` returns. One bus per call; the app composes
 *  cross-bus snapshots itself if it wants a multi-bus view. */
export interface CanBusSnapshot {
  capturedAtUnixMs: number;
  extension: {
    id: string;
    version: string;
    state: "installed" | "running" | "stopped" | "failed" | string;
  };
  bus: CanBusState;
}

// ─── DBC catalog shapes ─────────────────────────────────────────────────────

export interface DbcSignal {
  name: string;
  startBit: number;
  length: number;
  byteOrder: "little" | "big";
  isSigned: boolean;
  scale: number;
  offset: number;
  min?: number;
  max?: number;
  unit?: string;
  valueTable?: Record<string, string>;
  muxIndicator?: boolean;
  muxValue?: number | null;
}

export interface DbcMessage {
  name: string;
  canId: number;
  isExtended: boolean;
  dlc: number;
  cycleTimeMs?: number;
  signals: DbcSignal[];
}

export interface DbcCatalog {
  bus: string;
  dbcName?: string;
  messages: DbcMessage[];
}

// ─── Action parameter + result shapes ───────────────────────────────────────

export interface CanActionResult<T = unknown> {
  status: "pass" | "fail" | "done" | string;
  result: T;
}

export interface SendRawParams {
  /** Hex string, with or without `0x`. */
  canId: string;
  /** Hex bytes; spaces optional. */
  data: string;
  isExtended?: boolean;
  isFd?: boolean;
}

export interface StartPeriodicRawParams extends SendRawParams {
  periodMs: number;
}

export interface SendMessageParams {
  message: string;
  mux?: number | string | null;
  signals: Record<string, unknown>;
}

export interface StartPeriodicMessageParams extends SendMessageParams {
  periodMs: number;
}

export interface StopPeriodicParams {
  taskId: string;
}

export interface StartPeriodicResult {
  taskId: string;
  replaced: boolean;
}
