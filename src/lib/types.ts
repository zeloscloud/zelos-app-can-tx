/** Wire shapes shared by the bridge wrapper, mock host, and capability resolver.
 *
 *  Kept hand-maintained — the agent extension does not yet emit ts-rs bindings
 *  for these shapes. Until it does, the app fixtures and the agent serializer
 *  must stay in lock-step here.
 *
 *  Field naming follows the wire: snake_case. The codec's Python action
 *  signatures + return dicts use snake_case; the app's TS interfaces mirror
 *  that so the JSON round-trips without translation. */

/** CAN agent extension ID this app pins to in the manifest `requires` block.
 *  The codec reports this same ID in `get_tx_state.extension.id`. */
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

// ─── Bus snapshot shapes (wire = snake_case) ────────────────────────────────

export interface CanBusMetrics {
  tx_errors?: number;
  tx_overflows?: number;
  messages_received?: number;
  messages_decoded?: number;
  unknown_messages?: number;
}

export interface CanBusDbcMetadata {
  path?: string;
  name?: string;
  hash?: string;
  message_count?: number;
}

export interface CanPeriodicSlot {
  task_id: string;
  can_id: number;
  is_extended: boolean;
  is_fd: boolean;
  dlc: number;
  data_hex: string;
  period_ms: number;
  mode: "raw" | "dbc";
  is_active: boolean;
  message?: {
    name: string;
    mux?: number | string | null;
    signals?: Record<string, unknown>;
  };
  last_error?: string | null;
}

export interface CanBusState {
  name: string;
  interface: string;
  channel?: string;
  status: "active" | "stopped" | "error" | "unknown";
  dbc?: CanBusDbcMetadata;
  metrics?: CanBusMetrics;
  periodics: CanPeriodicSlot[];
  last_error?: string | null;
}

/** What `can/<bus>/get_tx_state` returns. One bus per call; the app composes
 *  cross-bus snapshots itself if it wants a multi-bus view. */
export interface CanBusSnapshot {
  captured_at_unix_ms: number;
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
  start_bit: number;
  length: number;
  byte_order: "little" | "big";
  is_signed: boolean;
  scale: number;
  offset: number;
  min?: number;
  max?: number;
  unit?: string;
  value_table?: Record<string, string>;
  mux_indicator?: boolean;
  mux_value?: number | null;
}

export interface DbcMessage {
  name: string;
  can_id: number;
  is_extended: boolean;
  dlc: number;
  cycle_time_ms?: number;
  signals: DbcSignal[];
}

export interface DbcCatalog {
  bus: string;
  dbc_name?: string;
  messages: DbcMessage[];
}

// ─── Action parameter + result shapes ───────────────────────────────────────

export interface CanActionResult<T = unknown> {
  status: "pass" | "fail" | "done" | string;
  result: T;
}

export interface SendRawParams {
  /** Hex string, with or without `0x`. */
  can_id: string;
  /** Hex bytes; spaces optional. */
  data: string;
  is_extended?: boolean;
  is_fd?: boolean;
}

export interface StartPeriodicRawParams extends SendRawParams {
  period_ms: number;
}

export interface StopPeriodicParams {
  task_id: string;
}

export interface StartPeriodicResult {
  task_id: string;
  replaced: boolean;
}
