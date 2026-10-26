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
import {
  findMessageByAddress,
  messageAddress,
  type DbcMessage,
  type DbcMessageSummary,
} from "@/lib/types";

export interface AddMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bridge: BridgeTransport;
  agentAddress: string;
  actionPrefix: string;
  bus: string;
  editRow?: TransmitRow | null;
  onSave: (row: NewTransmitRow, editId: string | null) => void;
}

export function AddMessageDialog({
  open,
  onOpenChange,
  bridge,
  agentAddress,
  actionPrefix,
  bus,
  editRow,
  onSave,
}: AddMessageDialogProps) {
  const isEdit = !!editRow;

  // The dialog mounts each time it opens, so its fields start from editRow or the add defaults.
  const [mode, setMode] = React.useState<TransmitMode>(editRow?.mode ?? "raw");
  const [periodMs, setPeriodMs] = React.useState<number>(editRow?.period_ms ?? 100);

  const [canId, setCanId] = React.useState<string>(editRow?.can_id ?? "0x100");
  const [data, setData] = React.useState<string>(editRow?.data ?? "00");
  const [isExtended, setIsExtended] = React.useState<boolean>(!!editRow?.is_extended);
  const [isFd, setIsFd] = React.useState<boolean>(!!editRow?.is_fd);

  const [dbcMessage, setDbcMessage] = React.useState<string>(editRow?.message ?? "");
  const [dbcMux, setDbcMux] = React.useState<string>(editRow?.mux ?? "");
  // Strings while editing; handleSave parses them back to numbers.
  const [dbcSignals, setDbcSignals] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(editRow?.signals ?? {}).map(([k, v]) => [k, String(v)])),
  );

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // The DBC hash from the bus snapshot keys both queries, so a DBC reload refetches them.
  const snapshotQuery = useBusSnapshot(bridge, agentAddress, actionPrefix, bus);
  const dbcHash = snapshotQuery.data?.bus?.dbc?.hash ?? null;

  const catalogQuery = useQuery({
    queryKey: ["can-list-messages", agentAddress, actionPrefix, bus, dbcHash ?? "no-hash"],
    queryFn: async () => listMessages(bridge, agentAddress, actionPrefix, bus),
    enabled: open && mode === "dbc" && !!bus,
    staleTime: dbcHash ? Infinity : 30_000,
  });

  const describeQuery = useQuery({
    queryKey: [
      "can-describe-message",
      agentAddress,
      actionPrefix,
      bus,
      dbcMessage,
      dbcHash ?? "no-hash",
    ],
    queryFn: async () => describeMessage(bridge, agentAddress, actionPrefix, bus, dbcMessage),
    enabled: open && mode === "dbc" && !!bus && !!dbcMessage,
    staleTime: dbcHash ? Infinity : 30_000,
  });

  const selectedDbcMessage: DbcMessage | undefined = describeQuery.data?.message;

  // A newly picked message resets the signals, since the extension rejects signals it lacks.
  const [seededMessage, setSeededMessage] = React.useState<DbcMessage | undefined>(undefined);
  if (selectedDbcMessage && selectedDbcMessage !== seededMessage) {
    setSeededMessage(selectedDbcMessage);
    const holdsEditRowMessage =
      editRow &&
      (messageAddress(selectedDbcMessage) === editRow.message ||
        selectedDbcMessage.name === editRow.message);
    if (!holdsEditRowMessage) {
      const next: Record<string, string> = {};
      for (const sig of selectedDbcMessage.signals) {
        if (sig.mux_indicator) continue;
        next[sig.name] = "0";
      }
      setDbcSignals(next);
      setDbcMux("");
      setPeriodMs(selectedDbcMessage.cycle_time_ms ?? 100);
    }
  }

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
      const muxIndicatorSig = selectedDbcMessage?.signals.find((s) => s.mux_indicator);
      const parsedMux = muxIndicatorSig ? Number(dbcMux) : null;
      if (muxIndicatorSig) {
        // The extension rejects an undeclared mux value with a less readable error.
        const declared = new Set(
          (selectedDbcMessage?.signals ?? [])
            .filter((s) => s.mux_value != null)
            .map((s) => s.mux_value),
        );
        if (declared.size > 0 && (!Number.isFinite(parsedMux) || !declared.has(parsedMux))) {
          const allowed = Array.from(declared)
            .sort((a, b) => Number(a) - Number(b))
            .join(", ");
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
          // A value-table label.
          signals[sigDef.name] = trimmed;
        }
      }
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
        ...(selectedDbcMessage?.name != null && { dbc_message_name: selectedDbcMessage.name }),
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
        (active ? "bg-background text-foreground shadow" : "hover:text-foreground")
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
  describeQuery: ReturnType<typeof useQuery<import("@/lib/types").DbcMessageDescription, Error>>;
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

/** A multiplexed message shows its signals once a mux value is picked. */
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

/** Three grid cells (label, control, hint), so every row shares the parent grid's columns. */
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
  // Lifts the focus ring above the next row, which would clip it.
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

/** Drops floating-point noise such as 0.10000000000000009 from a range hint. */
function formatRange(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return Number.parseFloat(n.toFixed(4)).toString();
}

/** The DBC's min/max intersected with the bit field's range, which the extension enforces. */
function signalPhysicalRange(
  signal: import("@/lib/types").DbcSignal,
): { min: number; max: number } | null {
  const fromField = fieldDerivedRange(signal);
  const fromDbc =
    signal.min != null && signal.max != null ? { min: signal.min, max: signal.max } : null;
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

/** A number input, plus a searchable value-table picker when there are choices. */
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
  onValueChange: (address: string) => void;
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

  // Names defined more than once also show their DBC file.
  const duplicated = React.useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const m of messages) {
      if (seen.has(m.name)) dupes.add(m.name);
      seen.add(m.name);
    }
    return dupes;
  }, [messages]);

  const selected = findMessageByAddress(messages, value);

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
                {duplicated.has(selected.name) && selected.database
                  ? ` · ${selected.database}`
                  : ""}
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
          className="z-[100] flex max-h-[min(480px,var(--radix-popover-content-available-height,480px))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          onOpenAutoFocus={(e) => {
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
                const address = messageAddress(m);
                const isActive = address === value;
                return (
                  <li key={address}>
                    <button
                      type="button"
                      onClick={() => {
                        onValueChange(address);
                        setOpen(false);
                      }}
                      className={
                        "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground " +
                        (isActive ? "bg-accent/50 font-medium" : "")
                      }
                    >
                      <span className="truncate">
                        {m.name}
                        {duplicated.has(m.name) && m.database ? (
                          <span className="ml-2 text-muted-foreground">{m.database}</span>
                        ) : null}
                      </span>
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
