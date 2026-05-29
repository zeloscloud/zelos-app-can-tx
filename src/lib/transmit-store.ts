/** localStorage-backed transmit-row state. PCAN-style templates: the user
 *  composes a message once, then the row sticks around until they delete it,
 *  survives reloads.
 *
 *  Rows are local-only — the agent doesn't know about them. The agent only
 *  knows about active periodic tasks (which the rows reference via task_id
 *  when started). */

const STORAGE_KEY = "zelos-app-can-tx.transmit-rows.v1";

export type TransmitMode = "raw" | "dbc";

export interface TransmitRow {
  /** Stable local id. Generated client-side so localStorage owns identity. */
  id: string;
  /** User-facing name. Auto-derived (`0x100` / DBC message name) at create time. */
  name: string;
  agent: string;
  bus: string;
  mode: TransmitMode;
  /** Default period in ms used when the user clicks Start (and for the input
   *  when editing). 100 if unspecified at create. */
  period_ms: number;

  // ─── Raw fields (mode === "raw") ─────────────────────────────────────
  can_id?: string;
  data?: string;
  is_extended?: boolean;
  is_fd?: boolean;

  // ─── DBC fields (mode === "dbc") ─────────────────────────────────────
  message?: string;
  /** Empty string when not multiplexed; integer or label otherwise. */
  mux?: string;
  signals?: Record<string, unknown>;

  // ─── Server-link state ───────────────────────────────────────────────
  /** task_id returned by the last start_periodic_* call. Lets us derive
   *  active/idle from a get_tx_state snapshot, and aim stop_periodic correctly. */
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
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust the shape — these are our own writes — but discard rows that
    // are obviously malformed so a bad localStorage entry can't crash the UI.
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
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Storage quota exceeded / disabled — silently drop; the UI still shows the
    // in-memory rows until the page is reloaded.
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
