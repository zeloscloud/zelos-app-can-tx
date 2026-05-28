/** PCAN-style composer for a single raw CAN frame.
 *
 *  Hex inputs are validated locally before submit so the user sees the error
 *  immediately rather than waiting for the round-trip. Server-side encode and
 *  range checks still apply — this is the cheap front line, not a substitute. */

import React from "react";

export interface RawComposerProps {
  /** Disable inputs + buttons while a parent-coordinated mutation is in flight. */
  busy: boolean;
  onSendOnce: (params: ParsedFrame) => Promise<void> | void;
  onStartPeriodic: (params: ParsedFrame & { period_ms: number }) => Promise<void> | void;
}

/** Wire-shaped output (snake_case) so callers can pass it straight to the
 *  agent's `send_raw` / `start_periodic_raw` action without translation. */
export interface ParsedFrame {
  can_id: string;
  data: string;
  is_extended: boolean;
  is_fd: boolean;
}

/** Hex with optional `0x` prefix and optional whitespace separators. */
const HEX_RE = /^(0x)?[0-9A-Fa-f]+$/;
const DATA_RE = /^[0-9A-Fa-f\s]*$/;

export function RawComposer({ busy, onSendOnce, onStartPeriodic }: RawComposerProps) {
  const [canId, setCanId] = React.useState("0x100");
  const [data, setData] = React.useState("01 02 03 04");
  const [isExtended, setIsExtended] = React.useState(false);
  const [isFd, setIsFd] = React.useState(false);
  const [periodMs, setPeriodMs] = React.useState(100);

  const canIdError = validateCanId(canId, isExtended);
  const dataError = validateData(data);
  const periodError = validatePeriod(periodMs);
  const formError = canIdError ?? dataError ?? periodError;

  function sendOnce() {
    if (formError) return;
    void onSendOnce({ can_id: canId, data, is_extended: isExtended, is_fd: isFd });
  }

  function startPeriodic() {
    if (formError) return;
    void onStartPeriodic({
      can_id: canId,
      data,
      is_extended: isExtended,
      is_fd: isFd,
      period_ms: periodMs,
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Raw composer</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <Field label="CAN ID (hex)" error={canIdError}>
          <input
            type="text"
            value={canId}
            onChange={(e) => setCanId(e.target.value)}
            placeholder="0x100"
            aria-invalid={canIdError != null}
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>

        <Field label="Period (ms)" error={periodError}>
          <input
            type="number"
            value={periodMs}
            min={1}
            max={60_000}
            onChange={(e) => setPeriodMs(Number(e.target.value))}
            aria-invalid={periodError != null}
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>

        <Field label="Data (hex bytes)" error={dataError} className="sm:col-span-2">
          <input
            type="text"
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder="01 02 03 04"
            aria-invalid={dataError != null}
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono"
          />
        </Field>

        <Toggle
          label="Extended ID (29-bit)"
          checked={isExtended}
          onChange={setIsExtended}
        />
        <Toggle label="CAN FD" checked={isFd} onChange={setIsFd} />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={busy || formError != null}
          onClick={sendOnce}
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
        >
          Send once
        </button>
        <button
          type="button"
          disabled={busy || formError != null}
          onClick={startPeriodic}
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
        >
          Start periodic
        </button>
      </div>
    </section>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-destructive">{error}</span>}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3"
      />
      <span>{label}</span>
    </label>
  );
}

// ─── Pure validators (tested at the helper seam) ────────────────────────────

export function validateCanId(raw: string, isExtended: boolean): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "required";
  if (!HEX_RE.test(trimmed)) return "must be hex";
  const value = Number.parseInt(trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed, 16);
  if (!Number.isFinite(value) || value < 0) return "must be a positive hex integer";
  const max = isExtended ? 0x1FFFFFFF : 0x7FF;
  if (value > max) return `exceeds ${isExtended ? "29-bit" : "11-bit"} max (0x${max.toString(16)})`;
  return null;
}

export function validateData(raw: string): string | null {
  if (!DATA_RE.test(raw)) return "must be hex bytes (whitespace allowed)";
  const stripped = raw.replace(/\s+/g, "");
  if (stripped.length % 2 !== 0) return "odd number of hex digits";
  return null;
}

export function validatePeriod(ms: number): string | null {
  if (!Number.isFinite(ms)) return "must be a number";
  if (ms < 1) return "must be ≥ 1 ms";
  if (ms > 60_000) return "must be ≤ 60_000 ms";
  return null;
}
