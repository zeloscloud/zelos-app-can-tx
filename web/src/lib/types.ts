/** Wire shapes of the CAN extension's actions, in its snake_case field names. */

export const CAN_EXTENSION_ID = "zeloscloud.zelos-extension-can";

/** `zelos extensions install-local` installs it as `local.<manifest name slug>`. */
export const CAN_EXTENSION_INSTALL_IDS: ReadonlySet<string> = new Set([
  CAN_EXTENSION_ID,
  "local.can",
]);

/** Every action is `CAN/<method>` and selects its bus with a `codec` parameter. */
export const CAN_METHODS = {
  listCodecs: "list_codecs",
  getTxState: "get_tx_state",
  listMessages: "list_messages",
  describeMessage: "describe_message",
  sendRaw: "send_raw",
  startPeriodicRaw: "start_periodic_raw",
  sendMessage: "send_message",
  startPeriodicMessage: "start_periodic_message",
  stopPeriodic: "stop_periodic",
} as const;

export type CanMethodName = (typeof CAN_METHODS)[keyof typeof CAN_METHODS];

export const REQUIRED_CAN_METHODS: readonly CanMethodName[] = [
  CAN_METHODS.listCodecs,
  CAN_METHODS.getTxState,
  CAN_METHODS.listMessages,
  CAN_METHODS.describeMessage,
  CAN_METHODS.sendRaw,
  CAN_METHODS.startPeriodicRaw,
  CAN_METHODS.sendMessage,
  CAN_METHODS.startPeriodicMessage,
  CAN_METHODS.stopPeriodic,
];

export const CAN_ACTION_PREFIX = "CAN/";

export function canActionPath(method: CanMethodName): string {
  return `${CAN_ACTION_PREFIX}${method}`;
}

// ─── Bus snapshot shapes (wire = snake_case) ────────────────────────────────

interface CanBusMetrics {
  tx_errors?: number;
  tx_overflows?: number;
  messages_received?: number;
  messages_decoded?: number;
  unknown_messages?: number;
}

interface CanBusDbcMetadata {
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

export interface CanBusSnapshot {
  captured_at_unix_ms: number;
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

/** One `list_messages` entry: no signals, which `describe_message` returns. */
export interface DbcMessageSummary {
  /** `{can_id:04x|08x}_{name}`, unique on the bus: the `message` action parameter. */
  key: string;
  name: string;
  can_id: number;
  is_extended: boolean;
  dlc: number;
  cycle_time_ms?: number;
  database?: string;
}

export interface DbcMessage extends DbcMessageSummary {
  signals: DbcSignal[];
}

export interface DbcCatalog {
  bus: string;
  dbc_name?: string;
  messages: DbcMessageSummary[];
}

export interface DbcMessageDescription {
  bus: string;
  dbc_name?: string;
  message: DbcMessage;
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

export interface SendMessageParams {
  message: string;
  /** JSON object of signal name to value. */
  signals_json: string;
  /** Empty string when not multiplexed; integer or label string otherwise. */
  mux?: string;
}

export interface StartPeriodicMessageParams extends SendMessageParams {
  period_ms: number;
}
