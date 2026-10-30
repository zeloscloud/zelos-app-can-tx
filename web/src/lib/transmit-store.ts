/** Transmit rows live in localStorage; the agent knows only the periodic tasks they start. */

const STORAGE_KEY = "zelos-app-can-tx.transmit-rows.v1";

export type TransmitMode = "raw" | "dbc";

export interface TransmitRow {
  id: string;
  name: string;
  agent: string;
  bus: string;
  mode: TransmitMode;
  period_ms: number;

  // ─── Raw fields (mode === "raw") ─────────────────────────────────────
  can_id?: string;
  data?: string;
  is_extended?: boolean;
  is_fd?: boolean;

  // ─── DBC fields (mode === "dbc") ─────────────────────────────────────
  /** The message's `key` from `list_messages`. */
  message?: string;
  /** Empty string when not multiplexed; integer or label otherwise. */
  mux?: string;
  signals?: Record<string, unknown>;
  /** Captured at save so the table renders without a catalog query per row. */
  dbc_message_name?: string;
  dbc_can_id?: number;
  dbc_dlc?: number;
  dbc_value_tables?: Record<string, Record<string, string>>;
  dbc_mux_signal?: string;

  // ─── Server-link state ───────────────────────────────────────────────
  /** From the last start_periodic_* call; the row is active while a snapshot lists it. */
  last_task_id?: string | null;
}

export type NewTransmitRow = Omit<TransmitRow, "id" | "last_task_id">;

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadRows(): TransmitRow[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof r.id === "string" &&
        typeof r.agent === "string" &&
        typeof r.bus === "string" &&
        (r.mode === "raw" || r.mode === "dbc"),
    ) as TransmitRow[];
  } catch {
    return [];
  }
}

export function saveRows(rows: readonly TransmitRow[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Storage full or disabled: the rows stay in memory until a reload.
  }
}

export function createRow(input: NewTransmitRow): TransmitRow {
  return { ...input, id: generateId(), last_task_id: null };
}

export function defaultRowName(input: NewTransmitRow): string {
  if (input.mode === "dbc" && input.message) return input.message;
  if (input.mode === "raw" && input.can_id) return input.can_id;
  return "new message";
}
