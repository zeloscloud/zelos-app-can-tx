/** Modal for adding/editing a transmit row. Agent + bus are implicit from
 *  whichever bus subcard opened the dialog — no in-dialog picker for either.
 *
 *  Flow: toggle Raw / DBC → fill the matching form → Save. For DBC, the
 *  message dropdown is sourced from `list_messages` on the (agent, bus) pair;
 *  picking a message auto-populates one input per signal with `0` defaults
 *  and captures the message's can_id + dlc for the row's table columns. */

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import * as React from "react";

import { useBusSnapshot } from "@/hooks/use-tx-state";
import { describeMessage, listMessages } from "@/lib/can-bridge";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  defaultRowName,
  type NewTransmitRow,
  type TransmitMode,
  type TransmitRow,
} from "@/lib/transmit-store";
import type { DbcMessage, DbcMessageSummary } from "@/lib/types";

export interface AddMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bridge: BridgeTransport;
  /** Agent + bus are implicit from which bus subcard triggered the dialog —
   *  no in-dialog picker for either. */
  agentAddress: string;
  bus: string;
  /** When set, dialog opens in edit mode — fields seeded from this row,
   *  Save button becomes "Save changes", onSave is called with editRow.id. */
  editRow?: TransmitRow | null;
  onSave: (row: NewTransmitRow, editId: string | null) => void;
}

export function AddMessageDialog({
  open,
  onOpenChange,
  bridge,
  agentAddress,
  bus,
  editRow,
  onSave,
}: AddMessageDialogProps) {
  const isEdit = !!editRow;

  const [mode, setMode] = React.useState<TransmitMode>("raw");
  const [periodMs, setPeriodMs] = React.useState<number>(100);

  // Raw fields
  const [canId, setCanId] = React.useState<string>("0x100");
  const [data, setData] = React.useState<string>("00");
  const [isExtended, setIsExtended] = React.useState<boolean>(false);
  const [isFd, setIsFd] = React.useState<boolean>(false);

  // DBC fields
  const [dbcMessage, setDbcMessage] = React.useState<string>("");
  const [dbcMux, setDbcMux] = React.useState<string>("");
  const [dbcSignals, setDbcSignals] = React.useState<Record<string, string>>({});
  // Per-signal override flag — when true, a value-table signal renders as a
  // free numeric input instead of the enum combobox, so the user can drop in
  // an int that's not in the table.

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // ─── (Re)initialize selection when the dialog opens ─────────────────────
  React.useEffect(() => {
    if (!open) return;
    if (editRow) {
      setMode(editRow.mode);
      setPeriodMs(editRow.period_ms);
      setCanId(editRow.can_id ?? "0x100");
      setData(editRow.data ?? "00");
      setIsExtended(!!editRow.is_extended);
      setIsFd(!!editRow.is_fd);
      setDbcMessage(editRow.message ?? "");
      setDbcMux(editRow.mux ?? "");
      // Stringify signal values so the inputs are controlled — they get
      // parsed back to numbers in handleSave.
      const seeded: Record<string, string> = {};
      for (const [k, v] of Object.entries(editRow.signals ?? {})) {
        seeded[k] = String(v);
      }
      setDbcSignals(seeded);
      setSubmitError(null);
      return;
    }
    setMode("raw");
    setPeriodMs(100);
    setCanId("0x100");
    setData("00");
    setIsExtended(false);
    setIsFd(false);
    setDbcMessage("");
    setDbcMux("");
    setDbcSignals({});
    setSubmitError(null);
  }, [open, editRow]);

  // ─── DBC catalog (two-tier, lazy) ───────────────────────────────────────
  //
  // 1. `list_messages` returns lightweight summaries — names + identifiers,
  //    no per-signal metadata. Cheap, fetched as soon as the dialog opens
  //    in DBC mode.
  //
  // 2. `describe_message(name)` fires only after the user picks a message,
  //    returning that one message's full signal detail.
  //
  // Both cache keys include the agent-reported DBC hash so any post-reload
  // change invalidates both tiers. The hash rides the 1 Hz bus snapshot
  // poll that's already running, so there's no extra agent traffic. When
  // the hash is unknown (older codec) we fall back to a 30 s stale-time.
  const snapshotQuery = useBusSnapshot(bridge, agentAddress, bus);
  const dbcHash = snapshotQuery.data?.bus?.dbc?.hash ?? null;

  const catalogQuery = useQuery({
    queryKey: ["can-list-messages", agentAddress, bus, dbcHash ?? "no-hash"],
    queryFn: async () => listMessages(bridge, agentAddress, bus),
    enabled: open && mode === "dbc" && !!bus,
    staleTime: dbcHash ? Infinity : 30_000,
  });

  const describeQuery = useQuery({
    queryKey: ["can-describe-message", agentAddress, bus, dbcMessage, dbcHash ?? "no-hash"],
    queryFn: async () => describeMessage(bridge, agentAddress, bus, dbcMessage),
    enabled: open && mode === "dbc" && !!bus && !!dbcMessage,
    staleTime: dbcHash ? Infinity : 30_000,
  });

  const selectedDbcMessage: DbcMessage | undefined = describeQuery.data?.message;

  // When detail arrives for the picked message, seed signal inputs with "0"
  // defaults and default the period to the DBC's cycle_time_ms (else 100).
  // Skip the multiplexer signal — the dedicated mux input handles it.
  //
  // Edit mode subtlety: don't clobber editRow's seeded values WHEN the user
  // is still pointed at the row's original message. But if they swap to a
  // different message in the combobox, the old signal names are structurally
  // wrong for the new message — re-seed to fresh defaults. Failing to do this
  // makes the agent try to encode signals that don't exist on the new
  // message, which cantools rejects with an error that breaks JSON encoding
  // on the agent side.
  React.useEffect(() => {
    if (!selectedDbcMessage) return;
    if (editRow && selectedDbcMessage.name === editRow.message) return;
    const next: Record<string, string> = {};
    for (const sig of selectedDbcMessage.signals) {
      if (sig.mux_indicator) continue;
      next[sig.name] = "0";
    }
    setDbcSignals(next);
    setDbcMux("");
    setPeriodMs(selectedDbcMessage.cycle_time_ms ?? 100);
  }, [selectedDbcMessage, editRow]);

  function handleSave() {
    setSubmitError(null);
    if (!Number.isFinite(periodMs) || periodMs < 1) {
      setSubmitError("Period (ms) must be ≥ 1.");
      return;
    }
    let input: NewTransmitRow;
    if (mode === "raw") {
      if (!canId.trim()) {
        setSubmitError("CAN ID is required.");
        return;
      }
      input = {
        name: defaultRowName({
          name: "",
          agent: agentAddress,
          bus,
          mode: "raw",
          period_ms: periodMs,
          can_id: canId,
        }),
        agent: agentAddress,
        bus,
        mode: "raw",
        period_ms: periodMs,
        can_id: canId.trim(),
        data: data.trim(),
        is_extended: isExtended,
        is_fd: isFd,
      };
    } else {
      if (!dbcMessage) {
        setSubmitError("Pick a DBC message.");
        return;
      }
      // Only ship signals that belong to the picked mux variant (or are
      // always-present, mux_value == null). Skip the mux indicator itself —
      // it travels via the dedicated `mux` action param. We still range-check
      // each value so cantools never sees an out-of-range encode.
      const muxIndicatorSig = selectedDbcMessage?.signals.find((s) => s.mux_indicator);
      const parsedMux = muxIndicatorSig ? Number(dbcMux) : null;
      if (muxIndicatorSig) {
        // cantools rejects any mux value that isn't declared as m<N> in the
        // DBC ("Expected one of {0, 1 or 2}, but got 5"). Catch it here so
        // the user gets a clear message instead of the agent's exception
        // bubbling back as a JSON parse error.
        const declared = new Set(
          (selectedDbcMessage?.signals ?? [])
            .filter((s) => s.mux_value != null)
            .map((s) => s.mux_value),
        );
        if (declared.size > 0 && (!Number.isFinite(parsedMux) || !declared.has(parsedMux))) {
          const allowed = Array.from(declared).sort((a, b) => Number(a) - Number(b)).join(", ");
          setSubmitError(
            `Multiplexer ${muxIndicatorSig.name} = ${dbcMux || "(empty)"} has no signals declared. Allowed values: ${allowed}.`,
          );
          return;
        }
      }
      const relevantSignals = (selectedDbcMessage?.signals ?? []).filter((s) => {
        if (s.mux_indicator) return false;
        if (!muxIndicatorSig) return true;
        if (s.mux_value == null) return true;
        return Number.isFinite(parsedMux) && s.mux_value === parsedMux;
      });
      const signals: Record<string, unknown> = {};
      for (const sigDef of relevantSignals) {
        const raw = dbcSignals[sigDef.name] ?? "0";
        const trimmed = raw.trim();
        if (trimmed === "") {
          signals[sigDef.name] = 0;
          continue;
        }
        if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
          const asNum = Number.parseFloat(trimmed);
          const range = signalPhysicalRange(sigDef);
          if (range && (asNum < range.min || asNum > range.max)) {
            setSubmitError(
              `${sigDef.name} = ${asNum} is out of range ${range.min}…${range.max}${sigDef.unit ? ` ${sigDef.unit}` : ""}.`,
            );
            return;
          }
          signals[sigDef.name] = asNum;
        } else {
          // Not numeric — pass through as a value-table label.
          signals[sigDef.name] = trimmed;
        }
      }
      // Pluck value tables off the selected message so the transmit-row
      // table can render "LABEL (int)" for enum-typed signals without
      // re-fetching describe_message per row. Also remember which signal is
      // the mux indicator so the row's mux line can format the same way.
      const valueTables: Record<string, Record<string, string>> = {};
      for (const sig of selectedDbcMessage?.signals ?? []) {
        if (sig.value_table && Object.keys(sig.value_table).length > 0) {
          valueTables[sig.name] = sig.value_table;
        }
      }
      const muxSignalName = selectedDbcMessage?.signals.find((s) => s.mux_indicator)?.name;
      input = {
        name: defaultRowName({
          name: "",
          agent: agentAddress,
          bus,
          mode: "dbc",
          period_ms: periodMs,
          message: dbcMessage,
        }),
        agent: agentAddress,
        bus,
        mode: "dbc",
        period_ms: periodMs,
        message: dbcMessage,
        mux: dbcMux.trim(),
        signals,
        ...(selectedDbcMessage?.can_id != null && { dbc_can_id: selectedDbcMessage.can_id }),
        ...(selectedDbcMessage?.dlc != null && { dbc_dlc: selectedDbcMessage.dlc }),
        ...(Object.keys(valueTables).length > 0 && { dbc_value_tables: valueTables }),
        ...(muxSignalName && { dbc_mux_signal: muxSignalName }),
      };
    }
    onSave(input, editRow?.id ?? null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit transmit message" : "Add transmit message"}</DialogTitle>
          <DialogDescription>
            Target <code className="font-mono">{agentAddress}</code> /{" "}
            <code className="font-mono">{bus}</code>. Saved rows live in this app's local storage;
            the agent only learns about a row when you click Send or Start.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Mode">
              <ModeToggle value={mode} onValueChange={setMode} />
            </Field>
            <div className="w-32">
              <Field label="Period (ms)">
                <Input
                  type="number"
                  min={1}
                  max={60_000}
                  value={periodMs}
                  onChange={(e) => setPeriodMs(Number(e.target.value))}
                />
              </Field>
            </div>
          </div>

          {mode === "raw" ? (
            <RawForm
              canId={canId}
              setCanId={setCanId}
              data={data}
              setData={setData}
              isExtended={isExtended}
              setIsExtended={setIsExtended}
              isFd={isFd}
              setIsFd={setIsFd}
            />
          ) : (
            <DbcForm
              catalogQuery={catalogQuery}
              describeQuery={describeQuery}
              selectedMessage={dbcMessage}
              onSelectMessage={setDbcMessage}
              dbcMessage={selectedDbcMessage}
              mux={dbcMux}
              setMux={setDbcMux}
              signals={dbcSignals}
              setSignals={setDbcSignals}
            />
          )}

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={mode === "dbc" && !dbcMessage}>
            {isEdit ? "Save changes" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Two-button segmented control for picking transmit mode. Matches the
 *  shadcn Tabs look — soft muted track with the active segment lifted on
 *  a card-colored background and a subtle shadow. */
function ModeToggle({
  value,
  onValueChange,
}: {
  value: TransmitMode;
  onValueChange: (v: TransmitMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Transmit mode"
      className="flex h-9 w-fit items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground"
    >
      <ModeSegment active={value === "raw"} onClick={() => onValueChange("raw")}>
        Raw
      </ModeSegment>
      <ModeSegment active={value === "dbc"} onClick={() => onValueChange("dbc")}>
        DBC
      </ModeSegment>
    </div>
  );
}

function ModeSegment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={
        "inline-flex h-full items-center rounded-sm px-3 text-xs font-medium transition-all " +
        (active
          ? "bg-background text-foreground shadow"
          : "hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function RawForm({
  canId,
  setCanId,
  data,
  setData,
  isExtended,
  setIsExtended,
  isFd,
  setIsFd,
}: {
  canId: string;
  setCanId: (v: string) => void;
  data: string;
  setData: (v: string) => void;
  isExtended: boolean;
  setIsExtended: (v: boolean) => void;
  isFd: boolean;
  setIsFd: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <Field label="CAN ID (hex)">
        <Input
          value={canId}
          onChange={(e) => setCanId(e.target.value)}
          placeholder="0x100"
          className="font-mono"
        />
      </Field>
      <Field label="Data (hex bytes)">
        <Input
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder="01 02 03 04"
          className="font-mono"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-6 pt-1 text-xs">
        <label className="flex items-center gap-2">
          <Switch checked={isExtended} onCheckedChange={setIsExtended} />
          Extended ID (29-bit)
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={isFd} onCheckedChange={setIsFd} />
          CAN FD
        </label>
      </div>
    </div>
  );
}

function DbcForm({
  catalogQuery,
  describeQuery,
  selectedMessage,
  onSelectMessage,
  dbcMessage,
  mux,
  setMux,
  signals,
  setSignals,
}: {
  catalogQuery: ReturnType<typeof useQuery<import("@/lib/types").DbcCatalog, Error>>;
  describeQuery: ReturnType<
    typeof useQuery<import("@/lib/types").DbcMessageDescription, Error>
  >;
  selectedMessage: string;
  onSelectMessage: (v: string) => void;
  dbcMessage: DbcMessage | undefined;
  mux: string;
  setMux: (v: string) => void;
  signals: Record<string, string>;
  setSignals: (next: Record<string, string>) => void;
}) {
  if (catalogQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading DBC catalog…</p>;
  }
  if (catalogQuery.isError) {
    return (
      <p className="text-xs text-destructive">
        Failed to load DBC catalog: {(catalogQuery.error as Error).message}
      </p>
    );
  }
  const messages = catalogQuery.data?.messages ?? [];
  return (
    <div className="space-y-4">
      <Field label={`DBC message (${messages.length} available)`}>
        <DbcMessageCombobox
          messages={messages}
          value={selectedMessage}
          onValueChange={onSelectMessage}
        />
      </Field>
      {selectedMessage && describeQuery.isLoading && (
        <p className="text-xs text-muted-foreground">Loading signal detail…</p>
      )}
      {selectedMessage && describeQuery.isError && (
        <p className="text-xs text-destructive">
          Failed to load signals: {(describeQuery.error as Error).message}
        </p>
      )}
      {dbcMessage && (
        <DbcSignalsSection
          dbcMessage={dbcMessage}
          mux={mux}
          setMux={setMux}
          signals={signals}
          setSignals={setSignals}
        />
      )}
    </div>
  );
}

/** Multiplexer picker + filtered signals grid.
 *
 *  For non-multiplexed messages: always shows every signal.
 *  For multiplexed messages:
 *    - Mux selector at the top: a HybridValueInput backed by the known mux
 *      values + the mux indicator's value_table for labels. User can pick a
 *      declared value or type any int (e.g. for raw-frame-style probing).
 *    - Until a mux value is picked, no signal inputs render — there's no
 *      sensible default since each mux variant has a different signal set.
 *    - Once picked, render always-present signals (mux_value == null) plus
 *      signals matching the chosen mux value. Signals not relevant to the
 *      picked mux variant are hidden. */
function DbcSignalsSection({
  dbcMessage,
  mux,
  setMux,
  signals,
  setSignals,
}: {
  dbcMessage: DbcMessage;
  mux: string;
  setMux: (v: string) => void;
  signals: Record<string, string>;
  setSignals: (next: Record<string, string>) => void;
}) {
  const muxIndicator = dbcMessage.signals.find((s) => s.mux_indicator);

  const muxOptions = React.useMemo(() => {
    if (!muxIndicator) return [];
    const known = new Set<string>();
    for (const s of dbcMessage.signals) {
      if (s.mux_value != null) known.add(String(s.mux_value));
    }
    const valueTable = muxIndicator.value_table ?? {};
    return Array.from(known)
      .sort((a, b) => Number(a) - Number(b))
      .map((v) => ({ value: v, label: valueTable[v] ?? `mux ${v}` }));
  }, [dbcMessage, muxIndicator]);

  const visibleSignals = React.useMemo(() => {
    const nonIndicator = dbcMessage.signals.filter((s) => !s.mux_indicator);
    if (!muxIndicator) return nonIndicator;
    if (!mux.trim()) return [];
    const parsed = Number(mux);
    return nonIndicator.filter(
      (s) => s.mux_value == null || (Number.isFinite(parsed) && s.mux_value === parsed),
    );
  }, [dbcMessage, muxIndicator, mux]);

  return (
    <>
      {muxIndicator && (
        <Field label={`Multiplexer (${muxIndicator.name})`}>
          <HybridValueInput
            value={mux}
            onChange={setMux}
            choices={muxOptions}
            placeholder="e.g. 0"
            inputMode="numeric"
            step="1"
          />
        </Field>
      )}

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Signals</Label>
        {muxIndicator && !mux.trim() ? (
          <p className="rounded-md border border-dashed border-border bg-background/30 px-3 py-4 text-xs text-muted-foreground">
            Pick a multiplexer value above to see its signals.
          </p>
        ) : visibleSignals.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-background/30 px-3 py-4 text-xs text-muted-foreground">
            No signals declared for multiplexer value <code>{mux}</code>.
          </p>
        ) : (
          // Three-column grid: every row's input lands in the same column,
          // so input widths are uniform regardless of label or range text.
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-x-3 gap-y-3">
            {visibleSignals.map((sig) => (
              <SignalInput
                key={sig.name}
                signal={sig}
                value={signals[sig.name] ?? "0"}
                onChange={(v) => setSignals({ ...signals, [sig.name]: v })}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** One row of the signals grid — emits three children (label, control, hint)
 *  as direct siblings of the parent grid so all rows share identical column
 *  widths. The focused control gets `focus-visible:relative focus-visible:z-10`
 *  so its ring paints above the next row's border (which would otherwise clip
 *  the bottom edge of the ring).
 *
 *  Signals with a value table get a HybridValueInput — a number input you
 *  can always type into PLUS a dropdown trigger for picking labeled entries.
 *  No mode toggle: both affordances coexist. */
function SignalInput({
  signal,
  value,
  onChange,
}: {
  signal: import("@/lib/types").DbcSignal;
  value: string;
  onChange: (v: string) => void;
}) {
  const choices = signal.value_table ? Object.entries(signal.value_table) : null;
  const range = signalPhysicalRange(signal);
  const focusRingClass = "focus-visible:relative focus-visible:z-10";

  return (
    <>
      <Label className="text-xs">
        {signal.name}
        {signal.unit && <span className="ml-1 text-muted-foreground">({signal.unit})</span>}
      </Label>
      <HybridValueInput
        value={value}
        onChange={onChange}
        choices={(choices ?? []).map(([num, label]) => ({ value: num, label }))}
        inputMode="decimal"
        step="any"
        {...(range ? { min: range.min, max: range.max } : {})}
        inputClassName={focusRingClass}
      />
      <span className="flex items-center gap-2 whitespace-nowrap text-[10px] text-muted-foreground/70">
        {range && (
          <span>
            ({formatRange(range.min)}…{formatRange(range.max)})
          </span>
        )}
        {signal.mux_value !== null && signal.mux_value !== undefined && (
          <Badge variant="outline" className="text-[10px]">
            mux={signal.mux_value}
          </Badge>
        )}
      </span>
    </>
  );
}

/** Trim a derived range bound to a sensible decimal length so hints don't
 *  show floating-point noise like 0.10000000000000009. */
function formatRange(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return Number.parseFloat(n.toFixed(4)).toString();
}

/** Effective physical (decoded) range for a DBC signal.
 *
 *  Two sources of truth exist:
 *    1. The DBC's explicit min/max annotations — semantic bounds the author
 *       wrote (e.g. "a cell voltage is 0..5 V").
 *    2. The math derived from length/is_signed/scale/offset — the maximum
 *       physical value the bit field can actually hold after cantools
 *       encodes physical → raw via `raw = (phys - offset) / scale`.
 *
 *  When both exist, return the **intersection** (tighter bound wins). This
 *  avoids the confusing case where DBC says "max = 5" but the 12-bit field
 *  with scale 0.001 can only hold up to raw 4095 = 4.095 phys, so a user
 *  entering 5 sails through the client check and then gets a cantools
 *  "Unsigned integer value 5000 out of range" from the agent. */
function signalPhysicalRange(
  signal: import("@/lib/types").DbcSignal,
): { min: number; max: number } | null {
  const fromField = fieldDerivedRange(signal);
  const fromDbc =
    signal.min != null && signal.max != null
      ? { min: signal.min, max: signal.max }
      : null;
  if (fromField && fromDbc) {
    return {
      min: Math.max(fromField.min, fromDbc.min),
      max: Math.min(fromField.max, fromDbc.max),
    };
  }
  return fromField ?? fromDbc;
}

function fieldDerivedRange(
  signal: import("@/lib/types").DbcSignal,
): { min: number; max: number } | null {
  if (!signal.length || signal.length <= 0) return null;
  const scale = signal.scale || 1;
  const offset = signal.offset || 0;
  let rawMin: number;
  let rawMax: number;
  if (signal.is_signed) {
    rawMin = -(2 ** (signal.length - 1));
    rawMax = 2 ** (signal.length - 1) - 1;
  } else {
    rawMin = 0;
    rawMax = 2 ** signal.length - 1;
  }
  const a = rawMin * scale + offset;
  const b = rawMax * scale + offset;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

/** Click-to-open combobox with substring filtering over message name + hex id.
 *
 *  Built on Radix Popover, which knows how to coexist with Radix Dialog —
 *  click/focus inside the popover are not treated as "outside the dialog",
 *  so the dialog stays open and the focus trap doesn't yank focus back. */
/** Number input + adjacent value-table dropdown trigger that share the same
 *  underlying string value. Always typeable; the dropdown is a searchable
 *  popover of labeled entries that, when picked, fill the input. No mode
 *  switch — both affordances coexist.
 *
 *  When `choices` is empty (signal has no value table), only the input
 *  renders — no dropdown trigger. */
function HybridValueInput({
  value,
  onChange,
  choices,
  placeholder,
  min,
  max,
  step,
  inputMode,
  inputClassName = "",
}: {
  value: string;
  onChange: (v: string) => void;
  choices: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: string | number;
  inputMode?: "decimal" | "numeric";
  inputClassName?: string;
}) {
  const hasChoices = choices.length > 0;
  return (
    <div className="flex w-full">
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        {...(min != null ? { min } : {})}
        {...(max != null ? { max } : {})}
        {...(step != null ? { step } : {})}
        {...(inputMode ? { inputMode } : {})}
        className={`w-full font-mono text-xs ${hasChoices ? "rounded-r-none border-r-0" : ""} ${inputClassName}`}
      />
      {hasChoices && <ValueTablePicker choices={choices} value={value} onPick={onChange} />}
    </div>
  );
}

/** The dropdown button half of HybridValueInput. Same Radix-Popover-inside-
 *  Dialog pattern as DbcMessageCombobox so click/focus stays trapped to the
 *  parent dialog correctly. Highlights the currently-matched entry. */
function ValueTablePicker({
  choices,
  value,
  onPick,
}: {
  choices: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter((o) => o.label.toLowerCase().includes(q) || o.value.includes(q));
  }, [choices, query]);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex h-9 shrink-0 items-center justify-center rounded-l-none rounded-r-md border border-input bg-background px-2 text-xs text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
          aria-label="Pick from value table"
          title="Pick from value table"
        >
          ▾
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={4}
          align="end"
          collisionPadding={8}
          className="z-[100] flex max-h-[min(360px,var(--radix-popover-content-available-height,360px))] min-w-[200px] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="shrink-0 rounded-none border-0 border-b border-border focus-visible:ring-0"
          />
          <ul className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No matches</li>
            ) : (
              filtered.map((opt) => {
                const isActive = opt.value === value;
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(opt.value);
                        setOpen(false);
                      }}
                      className={
                        "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground " +
                        (isActive ? "bg-accent/50 font-medium" : "")
                      }
                    >
                      <span className="truncate">{opt.label}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {opt.value}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function DbcMessageCombobox({
  messages,
  value,
  onValueChange,
}: {
  messages: readonly DbcMessageSummary[];
  value: string;
  onValueChange: (name: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => {
      const hex = `0x${m.can_id.toString(16)}`;
      return m.name.toLowerCase().includes(q) || hex.includes(q);
    });
  }, [messages, query]);

  const selected = messages.find((m) => m.name === value);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm hover:bg-accent hover:text-accent-foreground"
        >
          {selected ? (
            <span className="truncate">
              <span className="font-medium">{selected.name}</span>
              <span className="ml-2 text-muted-foreground">
                · 0x{selected.can_id.toString(16)} · {selected.dlc}B
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Select a message</span>
          )}
          <span className="ml-2 text-muted-foreground">▾</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          sideOffset={4}
          align="start"
          collisionPadding={8}
          // Match the trigger's width via Radix CSS var; cap the height and
          // delegate scroll to the inner list.
          className="z-[100] flex max-h-[min(480px,var(--radix-popover-content-available-height,480px))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          onOpenAutoFocus={(e) => {
            // Default focuses the first focusable inside Content — we want the
            // search Input specifically (which we render at the top).
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or 0xID…"
            className="shrink-0 rounded-none border-0 border-b border-border focus-visible:ring-0"
          />
          <ul className="flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No matches</li>
            ) : (
              filtered.map((m) => {
                const isActive = m.name === value;
                return (
                  <li key={m.name}>
                    <button
                      type="button"
                      onClick={() => {
                        onValueChange(m.name);
                        setOpen(false);
                      }}
                      className={
                        "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground " +
                        (isActive ? "bg-accent/50 font-medium" : "")
                      }
                    >
                      <span className="truncate">{m.name}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        0x{m.can_id.toString(16)} · {m.dlc}B
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
