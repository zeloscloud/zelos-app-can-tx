/** Wire shapes shared by the bridge wrapper, mock host, and capability resolver.
 *
 *  Mirrors `features/CAN_TRANSMIT.md` §5 Block E (state model) and Block D
 *  (action contract). Kept hand-maintained — the agent extension does not yet
 *  emit ts-rs bindings for these shapes. Until it does, the app fixtures and
 *  agent serializer must stay in lock-step here. */

/** CAN agent extension ID this app pins to. */
export const CAN_EXTENSION_ID = "zeloscloud.zelos-extension-can";

/** v1 action paths (namespace/action). Names mirror CAN_TRANSMIT.md §5 Block D.
 *  Until Phase 2 reconciles the extension, these are the target names; the
 *  mock host uses them and the real extension must register matching paths. */
export const CAN_ACTIONS = {
  getTxState: "can/get_tx_state",
  listMessages: "can/list_messages",
  sendRaw: "can/send_raw",
  startPeriodicRaw: "can/start_periodic_raw",
  sendMessage: "can/send_message",
  startPeriodicMessage: "can/start_periodic_message",
  stopPeriodic: "can/stop_periodic",
} as const;

export type CanActionPath = (typeof CAN_ACTIONS)[keyof typeof CAN_ACTIONS];

/** Action paths the app requires to be present on the agent before TX is enabled. */
export const REQUIRED_CAN_ACTIONS: readonly CanActionPath[] = [
  CAN_ACTIONS.getTxState,
  CAN_ACTIONS.listMessages,
  CAN_ACTIONS.sendRaw,
  CAN_ACTIONS.startPeriodicRaw,
  CAN_ACTIONS.sendMessage,
  CAN_ACTIONS.startPeriodicMessage,
  CAN_ACTIONS.stopPeriodic,
];

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
  bus: string;
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

export interface CanBusTxState {
  name: string;
  interface: string;
  channel?: string;
  status: "active" | "stopped" | "error" | "unknown";
  dbc?: CanBusDbcMetadata;
  metrics?: CanBusMetrics;
  periodics: CanPeriodicSlot[];
  lastError?: string | null;
}

export interface CanTransmitState {
  capturedAtUnixMs: number;
  extension: {
    id: string;
    version: string;
    state: "installed" | "running" | "stopped" | "failed" | string;
  };
  buses: CanBusTxState[];
}

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
  valueTable?: Record<number, string>;
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
  dbcHash?: string;
  messages: DbcMessage[];
}

/** Result envelope returned by the host for `actions.execute`. */
export interface CanActionResult<T = unknown> {
  status: "pass" | "fail" | "done" | string;
  result: T;
}

export interface SendRawParams {
  bus: string;
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
  bus: string;
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
