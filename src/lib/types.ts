/** Wire shapes shared by the bridge wrapper, mock host, and capability resolver.
 *
 *  Kept hand-maintained — the agent extension does not yet emit ts-rs bindings
 *  for these shapes. Until it does, the app fixtures and the agent serializer
 *  must stay in lock-step here.
 *
 *  Field naming follows the wire: snake_case. The codec's Python action
 *  signatures + return dicts use snake_case; the app's TS interfaces mirror
 *  that so the JSON round-trips without translation. */

/** Marketplace-canonical CAN agent extension ID. The codec self-declares this
 *  same value in `get_tx_state.extension.id` regardless of install method, and
 *  the app's manifest `requires` block pins to it. */
export const CAN_EXTENSION_ID = "zeloscloud.zelos-extension-can";

/** Every install ID the agent might surface for the CAN extension.
 *
 *  `extensions.list` reports the INSTALL ID, which depends on how the user got
 *  the extension onto the agent. Marketplace installs use the canonical id;
 *  `zelos extensions install-local` prefixes `local.` and uses the manifest
 *  `name` slug (so `name = "CAN"` → `local.can`). The capability resolver
 *  treats any of these as "the CAN extension is present". */
export const CAN_EXTENSION_INSTALL_IDS: ReadonlySet<string> = new Set([
  CAN_EXTENSION_ID,
  "local.can",
  "local.zelos-extension-can",
]);

/** Bare method names exposed by the CAN extension. The on-wire surface is a
 *  single global namespace: every method is `<prefix>/<method>` and takes a
 *  `codec` parameter (the bus name) to select which bus to operate on.
 *  Per-bus actions (`<prefix>/<bus>/<method>`) are NOT used — see ARCHITECTURE
 *  note in this file for the rationale. Use {@link canActionPath} to build
 *  a full path, with a prefix from {@link resolveCanActionPrefix}. */
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

/** Action paths every running CAN extension is expected to surface before the
 *  app considers it ready. `list_codecs` is the discovery action; the rest
 *  are operations the UI depends on. `describe_message` is included so the
 *  Add-message dialog isn't fooled by an extension that ships `list_messages`
 *  without it. */
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

/** What the extension called its action namespace before it was aligned with
 *  the manifest's user-visible name. Kept as the fallback so an older install
 *  keeps working against a newer app. */
export const LEGACY_CAN_ACTION_PREFIX = "can";

/** Build the full action path for a given method under a resolved namespace.
 *
 *  The prefix is discovered per agent rather than hardcoded — see
 *  {@link resolveCanActionPrefix}. Two agents on one workspace can be running
 *  different extension versions, so the namespace is a property of the agent,
 *  not of the app. */
export function canActionPath(method: CanMethodName | string, prefix: string): string {
  return `${prefix}/${method}`;
}

/** Find which namespace this agent serves the CAN actions under.
 *
 *  The extension addresses its actions under the name its manifest declares,
 *  which is `CAN`; older builds used `can`. Rather than probing both, take the
 *  answer from the agent's own action list: the namespace serving
 *  `list_codecs` is the one to talk to. That keeps working through any future
 *  rename, and through an agent running two CAN-ish extensions, without the
 *  app having to know the history.
 *
 *  Returns `null` when no namespace on this agent serves the discovery action,
 *  which the resolver reports as a missing-actions state rather than guessing.
 */
export function resolveCanActionPrefix(actionPaths: readonly string[]): string | null {
  const known = new Set<string>(Object.values(CAN_METHODS));

  // Scored across every known method, not just the discovery action: an
  // extension that registered a partial surface still needs a namespace, or
  // the resolver could not tell "wrong version" from "no CAN extension here".
  const hits = new Map<string, number>();
  for (const path of actionPaths) {
    const cut = path.lastIndexOf("/");
    if (cut <= 0) continue;
    if (!known.has(path.slice(cut + 1))) continue;
    const prefix = path.slice(0, cut);
    hits.set(prefix, (hits.get(prefix) ?? 0) + 1);
  }
  if (hits.size === 0) return null;

  // Deterministic when an agent somehow serves more than one: most methods
  // wins, then a case-insensitive `can`, then sorted order — so the choice
  // never depends on the order the agent happened to list them in.
  return [...hits.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const aCanon = a[0].toLowerCase() === LEGACY_CAN_ACTION_PREFIX ? 0 : 1;
    const bCanon = b[0].toLowerCase() === LEGACY_CAN_ACTION_PREFIX ? 0 : 1;
    if (aCanon !== bCanon) return aCanon - bCanon;
    return a[0].localeCompare(b[0]);
  })[0]![0];
}

// `can/list_codecs` returns `{ codecs: string[] }` — defined inline in
// can-bridge.ts since it has a single caller.

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

/** What `can/get_tx_state` returns (one snapshot per `codec` selector). The
 *  app composes cross-bus snapshots itself if it wants a multi-bus view.
 *
 *  Extension id/version/state are intentionally NOT in this shape — that
 *  info is canonical at the `extensions.list` bridge surface, consumed by
 *  the capability resolver. Don't re-add it here; the 1 Hz snapshot poll
 *  shouldn't be doubling as a discovery channel. */
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

/** Lightweight identifier-only shape returned by `list_messages` — used to
 *  populate the message picker without pulling per-signal metadata across
 *  the wire. Picking a message fires `describe_message` for the full detail. */
export interface DbcMessageSummary {
  name: string;
  can_id: number;
  is_extended: boolean;
  dlc: number;
  cycle_time_ms?: number;
}

/** Full per-message detail returned by `describe_message` — extends the
 *  summary with the signal array. */
export interface DbcMessage extends DbcMessageSummary {
  signals: DbcSignal[];
}

export interface DbcCatalog {
  bus: string;
  dbc_name?: string;
  messages: DbcMessageSummary[];
}

/** Response shape for `describe_message` — one message wrapped with the bus
 *  + dbc identifier so the webapp can sanity-check the response against the
 *  request context. */
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

/** DBC message-encoded send. `signals_json` is a JSON-stringified
 *  `Record<signal_name, value>` — the wire format the codec expects. */
export interface SendMessageParams {
  message: string;
  signals_json: string;
  /** Empty string when not multiplexed; integer or label string otherwise. */
  mux?: string;
}

export interface StartPeriodicMessageParams extends SendMessageParams {
  period_ms: number;
}
