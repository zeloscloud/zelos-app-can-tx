/** Modal for adding a new transmit row.
 *
 *  Flow: pick agent → pick bus → choose Raw or DBC → fill the matching form
 *  → Save. For DBC, the message dropdown is sourced from `list_messages` on
 *  the selected (agent, bus); selecting a message auto-populates one input
 *  per signal with `0` defaults. */

import { useQuery } from "@tanstack/react-query";
import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import * as React from "react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AgentStatus, ReadyBus } from "@/lib/capability";
import { listMessages } from "@/lib/can-bridge";
import { defaultRowName, type NewTransmitRow, type TransmitMode } from "@/lib/transmit-store";
import type { DbcMessage } from "@/lib/types";

export interface AddMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bridge: BridgeTransport;
  agents: readonly AgentStatus[];
  /** When opening, default the agent/bus selection to these if provided. */
  defaultAgent?: string | null;
  defaultBus?: string | null;
  onSave: (row: NewTransmitRow) => void;
}

export function AddMessageDialog({
  open,
  onOpenChange,
  bridge,
  agents,
  defaultAgent,
  defaultBus,
  onSave,
}: AddMessageDialogProps) {
  const readyAgents = React.useMemo(
    () => agents.filter((a): a is AgentStatus & { kind: "ready"; buses: readonly ReadyBus[] } =>
      a.kind === "ready" && !!a.buses && a.buses.length > 0,
    ),
    [agents],
  );

  const [agent, setAgent] = React.useState<string>("");
  const [bus, setBus] = React.useState<string>("");
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

  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // ─── (Re)initialize selection when the dialog opens ─────────────────────
  React.useEffect(() => {
    if (!open) return;
    const explicit = defaultAgent ? readyAgents.find((a) => a.agent === defaultAgent) : undefined;
    const preferred = explicit ?? readyAgents[0];
    const initialAgent = preferred?.agent ?? "";
    const matchingBus = defaultBus
      ? preferred?.buses.find((b) => b.name === defaultBus)?.name
      : undefined;
    const initialBus = matchingBus ?? preferred?.buses[0]?.name ?? "";
    setAgent(initialAgent);
    setBus(initialBus);
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
  }, [open, defaultAgent, defaultBus, readyAgents]);

  // Keep bus selection valid as agent changes.
  React.useEffect(() => {
    const selectedAgent = readyAgents.find((a) => a.agent === agent);
    if (!selectedAgent) return;
    if (!selectedAgent.buses.some((b) => b.name === bus)) {
      setBus(selectedAgent.buses[0]?.name ?? "");
    }
  }, [agent, bus, readyAgents]);

  // ─── DBC catalog (only fetched when mode is DBC and we have a target) ──
  const catalogQuery = useQuery({
    queryKey: ["can-list-messages", agent, bus],
    queryFn: async () => listMessages(bridge, agent, bus),
    enabled: open && mode === "dbc" && !!agent && !!bus,
    staleTime: 30_000,
  });

  const selectedDbcMessage: DbcMessage | undefined = React.useMemo(() => {
    const messages = catalogQuery.data?.messages ?? [];
    return messages.find((m) => m.name === dbcMessage);
  }, [catalogQuery.data, dbcMessage]);

  // When the user picks a message, seed signal inputs with "0" defaults.
  React.useEffect(() => {
    if (!selectedDbcMessage) return;
    const next: Record<string, string> = {};
    for (const sig of selectedDbcMessage.signals) {
      // Skip the multiplexer signal — the dedicated mux input handles it.
      if (sig.mux_indicator) continue;
      next[sig.name] = "0";
    }
    setDbcSignals(next);
  }, [selectedDbcMessage]);

  function handleSave() {
    setSubmitError(null);
    if (!agent || !bus) {
      setSubmitError("Pick an agent and a bus.");
      return;
    }
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
          agent,
          bus,
          mode: "raw",
          period_ms: periodMs,
          can_id: canId,
        }),
        agent,
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
      // Convert each signal input to number if numeric, else keep as string
      // (value-table labels). cantools accepts both on the agent side.
      const signals: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(dbcSignals)) {
        const trimmed = v.trim();
        if (trimmed === "") {
          signals[k] = 0;
          continue;
        }
        const asNum = Number(trimmed);
        signals[k] = Number.isFinite(asNum) ? asNum : trimmed;
      }
      input = {
        name: defaultRowName({
          name: "",
          agent,
          bus,
          mode: "dbc",
          period_ms: periodMs,
          message: dbcMessage,
        }),
        agent,
        bus,
        mode: "dbc",
        period_ms: periodMs,
        message: dbcMessage,
        mux: dbcMux.trim(),
        signals,
      };
    }
    onSave(input);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add transmit message</DialogTitle>
          <DialogDescription>
            Pick a target agent + bus, then compose the frame. Saved rows live in this app's
            local storage; the agent only learns about a row when you click Send or Start.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent">
              <Select value={agent} onValueChange={setAgent} disabled={readyAgents.length === 0}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an agent" />
                </SelectTrigger>
                <SelectContent>
                  {readyAgents.map((a) => (
                    <SelectItem key={a.agent} value={a.agent}>
                      {a.agent}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Bus">
              <Select value={bus} onValueChange={setBus} disabled={!agent}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bus" />
                </SelectTrigger>
                <SelectContent>
                  {(readyAgents.find((a) => a.agent === agent)?.buses ?? []).map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode">
              <Select value={mode} onValueChange={(v) => setMode(v as TransmitMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw">Raw</SelectItem>
                  <SelectItem value="dbc">DBC-encoded</SelectItem>
                </SelectContent>
              </Select>
            </Field>
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
              query={catalogQuery}
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
          <Button
            onClick={handleSave}
            disabled={!agent || !bus || (mode === "dbc" && !dbcMessage)}
          >
            Save
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
    <>
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
      <div className="flex flex-wrap items-center gap-6 text-xs">
        <label className="flex items-center gap-2">
          <Switch checked={isExtended} onCheckedChange={setIsExtended} />
          Extended ID (29-bit)
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={isFd} onCheckedChange={setIsFd} />
          CAN FD
        </label>
      </div>
    </>
  );
}

function DbcForm({
  query,
  selectedMessage,
  onSelectMessage,
  dbcMessage,
  mux,
  setMux,
  signals,
  setSignals,
}: {
  query: ReturnType<typeof useQuery<import("@/lib/types").DbcCatalog, Error>>;
  selectedMessage: string;
  onSelectMessage: (v: string) => void;
  dbcMessage: DbcMessage | undefined;
  mux: string;
  setMux: (v: string) => void;
  signals: Record<string, string>;
  setSignals: (next: Record<string, string>) => void;
}) {
  if (query.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading DBC catalog…</p>;
  }
  if (query.isError) {
    return (
      <p className="text-xs text-destructive">
        Failed to load DBC catalog: {(query.error as Error).message}
      </p>
    );
  }
  const messages = query.data?.messages ?? [];
  return (
    <>
      <Field label={`DBC message (${messages.length} available)`}>
        <Select value={selectedMessage} onValueChange={onSelectMessage}>
          <SelectTrigger>
            <SelectValue placeholder="Select a message" />
          </SelectTrigger>
          <SelectContent>
            {messages.map((m) => (
              <SelectItem key={m.name} value={m.name}>
                {m.name} · 0x{m.can_id.toString(16)} · {m.dlc}B
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {dbcMessage && (
        <>
          {dbcMessage.signals.some((s) => s.mux_indicator) && (
            <Field label="Multiplexer value">
              <Input
                value={mux}
                onChange={(e) => setMux(e.target.value)}
                placeholder="0"
                className="font-mono"
              />
            </Field>
          )}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Signals</Label>
            {dbcMessage.signals
              .filter((s) => !s.mux_indicator)
              .map((sig) => (
                <SignalInput
                  key={sig.name}
                  signal={sig}
                  value={signals[sig.name] ?? "0"}
                  onChange={(v) => setSignals({ ...signals, [sig.name]: v })}
                />
              ))}
          </div>
        </>
      )}
    </>
  );
}

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
  return (
    <div className="flex items-center gap-2">
      <Label className="w-1/3 text-xs">
        {signal.name}
        {signal.unit && <span className="ml-1 text-muted-foreground">({signal.unit})</span>}
      </Label>
      {choices && choices.length > 0 ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map(([num, label]) => (
              <SelectItem key={num} value={num}>
                {label} ({num})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 font-mono text-xs" />
      )}
      {signal.mux_value !== null && signal.mux_value !== undefined && (
        <Badge variant="outline" className="text-[10px]">
          mux={signal.mux_value}
        </Badge>
      )}
    </div>
  );
}
