/** One panel per discovered agent. Header shows the agent address + CAN-extension
 *  version + start/stop toggle. Body is one BusSection per ready bus, each with
 *  its own stats line, Add-message button, and PCAN-style transmit table. */

import { extensions, type BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { AlertCircle, Loader2, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { copyToClipboard } from "@/lib/clipboard";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useBusSnapshot } from "@/hooks/use-tx-state";
import type { AgentStatus } from "@/lib/capability";
import {
  sendMessage,
  sendRaw,
  startPeriodicMessage,
  startPeriodicRaw,
  stopPeriodic,
} from "@/lib/can-bridge";
import type { TransmitRow } from "@/lib/transmit-store";

export interface AgentPanelProps {
  bridge: BridgeTransport;
  agent: AgentStatus;
  rows: readonly TransmitRow[];
  onAddClick: (agent: string, bus: string) => void;
  onEditRow: (row: TransmitRow) => void;
  onUpdateRow: (id: string, patch: Partial<TransmitRow>) => void;
  onRemoveRow: (id: string) => void;
  /** Re-runs the discovery queries so the UI reflects post-start/stop state. */
  onRefresh: () => void;
}

export function AgentPanel({
  bridge,
  agent,
  rows,
  onAddClick,
  onEditRow,
  onUpdateRow,
  onRemoveRow,
  onRefresh,
}: AgentPanelProps) {
  const isReady = agent.kind === "ready" && !!agent.buses && agent.buses.length > 0;

  return (
    <Card>
      <CardHeader className="space-y-2 px-6 pt-3 pb-1">
        <div className="flex flex-row items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="font-mono text-sm">{agent.agent}</CardTitle>
            <AgentBadge agent={agent} />
          </div>
          {agent.extension && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">CAN v{agent.extension.version}</span>
              <ExtensionToggle
                bridge={bridge}
                agentAddress={agent.agent}
                extensionId={agent.extension.id}
                state={agent.extension.state}
                onRefresh={onRefresh}
              />
            </div>
          )}
        </div>

        {agent.kind === "extension-missing" && (
          <p className="text-xs text-muted-foreground">
            Install the CAN extension from the marketplace, or run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              zelos extensions install-local &lt;path-to-zelos-extension-can&gt;
            </code>{" "}
            and Refresh.
          </p>
        )}

        {agent.kind === "extension-stopped" && (
          <p className="text-xs text-muted-foreground">
            Start it via the desktop's extensions panel, or run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">
              zelos extensions start {agent.extension?.id ?? "local.can"}
            </code>{" "}
            and Refresh.
          </p>
        )}

        {agent.kind === "no-ready-buses" &&
          agent.missingMethods &&
          agent.missingMethods.length > 0 && (
            <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">
              {`Extension is running but missing required actions:\n  ${agent.missingMethods.join("\n  ")}`}
            </pre>
          )}
        {agent.kind === "no-ready-buses" &&
          (!agent.missingMethods || agent.missingMethods.length === 0) && (
            <p className="text-xs text-muted-foreground">
              The extension is running but no buses are configured. Check the extension's bus list.
            </p>
          )}
        {agent.kind === "discovering-codecs" && (
          <p className="text-xs text-muted-foreground">Discovering buses…</p>
        )}
      </CardHeader>

      {isReady && (
        <CardContent className="px-3 pt-2 pb-4">
          <div className="flex flex-col gap-4">
            {agent.buses!.map((b) => (
              <BusSection
                key={b.name}
                bridge={bridge}
                agentAddress={agent.agent}
                bus={b.name}
                rows={rows.filter((r) => r.bus === b.name)}
                onAdd={() => onAddClick(agent.agent, b.name)}
                onEditRow={onEditRow}
                onUpdateRow={onUpdateRow}
                onRemoveRow={onRemoveRow}
              />
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function BusSection({
  bridge,
  agentAddress,
  bus,
  rows,
  onAdd,
  onEditRow,
  onUpdateRow,
  onRemoveRow,
}: {
  bridge: BridgeTransport;
  agentAddress: string;
  bus: string;
  rows: readonly TransmitRow[];
  onAdd: () => void;
  onEditRow: (row: TransmitRow) => void;
  onUpdateRow: (id: string, patch: Partial<TransmitRow>) => void;
  onRemoveRow: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40">
      <BusStatsRow bridge={bridge} agent={agentAddress} bus={bus} onAdd={onAdd} />
      <div className="border-t border-border px-3 py-3">
        {rows.length === 0 ? (
          <EmptyState bus={bus} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] table-fixed text-xs">
              <colgroup>
                <col className="w-[64px]" />
                <col className="w-[40px]" />
                <col className="w-[18%]" />
                <col className="w-[28%]" />
                <col className="w-[88px]" />
                <col className="w-[56px]" />
                <col className="w-[72px]" />
                <col className="w-[44px]" />
                <col className="w-[52px]" />
              </colgroup>
              <thead className="text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <Th>ID</Th>
                  <Th className="text-center">DLC</Th>
                  <Th>Message</Th>
                  <Th>Data</Th>
                  <Th className="text-center">Period (ms)</Th>
                  <Th className="text-center">Send</Th>
                  <Th className="text-center">Periodic</Th>
                  <Th className="text-center">Edit</Th>
                  <Th className="text-center">Delete</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TransmitRowView
                    key={row.id}
                    bridge={bridge}
                    row={row}
                    onUpdate={(patch) => onUpdateRow(row.id, patch)}
                    onEdit={() => onEditRow(row)}
                    onRemove={() => onRemoveRow(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`py-2 px-1.5 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2 px-1.5 align-top ${className}`}>{children}</td>;
}

function EmptyState({ bus }: { bus: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-background/30 py-6 text-center text-sm text-muted-foreground">
      No transmit messages on {bus} yet. Use <strong>Add message</strong> above to compose one.
    </div>
  );
}

/** Start/Stop button for the agent's CAN extension. Uses extensions.start with
 *  null config (the host's last-saved config) — there is no way for this UI
 *  to inject a config payload through the bridge surface, by design. */
function ExtensionToggle({
  bridge,
  agentAddress,
  extensionId,
  state,
  onRefresh,
}: {
  bridge: BridgeTransport;
  agentAddress: string;
  extensionId: string;
  state: string;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState<"start" | "stop" | null>(null);
  const isRunning = state === "running";

  async function toggle() {
    const op = isRunning ? "stop" : "start";
    setBusy(op);
    try {
      if (isRunning) {
        await extensions.stop(bridge, { id: extensionId, agent: agentAddress });
      } else {
        await extensions.start(bridge, { id: extensionId, agent: agentAddress });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to ${op} CAN extension on ${agentAddress}`, {
        description: humanizeActionError(message),
        duration: 8000,
      });
    } finally {
      setBusy(null);
      onRefresh();
    }
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-7 w-7"
      onClick={toggle}
      disabled={busy !== null}
      title={isRunning ? "Stop the CAN extension" : "Start the CAN extension"}
      aria-label={isRunning ? "Stop the CAN extension" : "Start the CAN extension"}
    >
      {isRunning ? (
        <Square className="h-3.5 w-3.5 text-red-500" />
      ) : (
        <Play className="h-3.5 w-3.5 text-emerald-500" />
      )}
    </Button>
  );
}

function AgentBadge({ agent }: { agent: AgentStatus }) {
  switch (agent.kind) {
    case "ready":
      return null;
    case "extension-stopped":
      return <Badge variant="warning">extension stopped</Badge>;
    case "no-ready-buses":
      return <Badge variant="warning">no usable buses</Badge>;
    case "extension-missing":
      return <Badge variant="destructive">extension not installed</Badge>;
  }
}

/** Bus header — name + status badge on the first line; interface + metrics on
 *  the second line. Add-message button anchored right, stretches the full row
 *  height (`self-stretch`) so it stays visible regardless of how the left
 *  column wraps. */
function BusStatsRow({
  bridge,
  agent,
  bus,
  onAdd,
}: {
  bridge: BridgeTransport;
  agent: string;
  bus: string;
  onAdd: () => void;
}) {
  const snapshotQuery = useBusSnapshot(bridge, agent, bus);
  const data = snapshotQuery.data?.bus;
  const err = snapshotQuery.error instanceof Error ? snapshotQuery.error : null;
  const fps = useRxFps(snapshotQuery.data);

  return (
    <div className="flex items-stretch gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
          <strong className="text-sm">{data?.name ?? bus}</strong>
          {data ? (
            <StatusBadge status={data.status} />
          ) : err ? (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              snapshot error
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              loading
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
          {data?.interface && (
            <span>
              {data.interface}
              {data.channel ? ` · ${data.channel}` : ""}
            </span>
          )}
          <span>rx {data?.metrics?.messages_received ?? "—"}</span>
          <span>{fps != null ? `${fps.toFixed(1)} f/s` : "— f/s"}</span>
          <span>dec {data?.metrics?.messages_decoded ?? "—"}</span>
          <span>unk {data?.metrics?.unknown_messages ?? "—"}</span>
          <span>tx-err {data?.metrics?.tx_errors ?? "—"}</span>
        </div>
        {err && <p className="text-[11px] text-destructive">{err.message}</p>}
      </div>
      <Button variant="outline" onClick={onAdd} className="h-auto shrink-0 self-stretch px-4">
        <Plus className="h-4 w-4" />
        Add message
      </Button>
    </div>
  );
}

/** Derives rx frames-per-second from consecutive get_tx_state snapshots —
 *  diff of the cumulative `messages_received` over the wall-clock interval
 *  between `captured_at_unix_ms` samples. Returns null until we have a
 *  baseline; clamps to >= 0 to ignore counter resets on extension restart. */
function useRxFps(snapshot: import("@/lib/types").CanBusSnapshot | undefined): number | null {
  const prevRef = React.useRef<{ ts: number; rx: number } | null>(null);
  const [fps, setFps] = React.useState<number | null>(null);

  React.useEffect(() => {
    const rx = snapshot?.bus?.metrics?.messages_received;
    const ts = snapshot?.captured_at_unix_ms;
    if (rx == null || ts == null) return;
    const prev = prevRef.current;
    if (prev && ts > prev.ts) {
      const dt = (ts - prev.ts) / 1000;
      const drx = rx - prev.rx;
      setFps(Math.max(0, drx / dt));
    }
    prevRef.current = { ts, rx };
  }, [snapshot]);

  return fps;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "active" ? "success" : status === "error" ? "destructive" : "warning";
  return <Badge variant={variant}>{status}</Badge>;
}

/** Per-row component. TanStack Query dedupes by key, so all rows on the
 *  same bus share one underlying poll with BusStatsRow. */
function TransmitRowView({
  bridge,
  row,
  onUpdate,
  onEdit,
  onRemove,
}: {
  bridge: BridgeTransport;
  row: TransmitRow;
  onUpdate: (patch: Partial<TransmitRow>) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const snapshotQuery = useBusSnapshot(bridge, row.agent, row.bus);
  const isActive =
    !!row.last_task_id &&
    !!snapshotQuery.data?.bus.periodics.some((p) => p.task_id === row.last_task_id);

  const [busy, setBusy] = React.useState<"send" | "start" | "stop" | "delete" | null>(null);

  // Local mirror of the period input so the user can type freely; we commit
  // back to the row store on blur so partial typing (e.g. clearing the field)
  // doesn't briefly write `NaN`.
  const [periodDraft, setPeriodDraft] = React.useState<string>(String(row.period_ms));
  React.useEffect(() => {
    setPeriodDraft(String(row.period_ms));
  }, [row.period_ms]);

  function commitPeriod() {
    const parsed = Number(periodDraft);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setPeriodDraft(String(row.period_ms));
      return;
    }
    if (parsed !== row.period_ms) onUpdate({ period_ms: parsed });
  }

  const ACTION_LABELS: Record<NonNullable<typeof busy>, string> = {
    send: "Send",
    start: "Start periodic",
    stop: "Stop periodic",
    delete: "Delete",
  };

  async function withBusy<T>(
    label: NonNullable<typeof busy>,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(label);
    try {
      return await fn();
    } catch (e) {
      // Pop a toast instead of stuffing the message into the row — long
      // python tracebacks like "Signed integer value 163 out of range" don't
      // fit and the row is already busy with controls.
      const message = e instanceof Error ? e.message : String(e);
      const debug = {
        label,
        agent: row.agent,
        bus: row.bus,
        row: {
          id: row.id,
          name: row.name,
          mode: row.mode,
          can_id: row.can_id,
          data: row.data,
          message: row.message,
          mux: row.mux,
          signals: row.signals,
          period_ms: row.period_ms,
        },
        error: message,
      };
      // biome-ignore lint/suspicious/noConsole: developer escape hatch for action failures
      console.error("[CAN-TX] action failed", debug);
      toast.error(`${ACTION_LABELS[label]} failed`, {
        description: humanizeActionError(message),
        duration: 10000,
        action: {
          label: "Copy details",
          onClick: () => {
            // Use the iframe-aware clipboard helper (navigator.clipboard is
            // blocked under the zelos-app:// sandbox; the helper falls back
            // to document.execCommand).
            const payload = JSON.stringify(debug, null, 2);
            void copyToClipboard(payload).then((ok) => {
              if (ok) toast.success("Failure details copied to clipboard");
              else toast.error("Clipboard blocked — see devtools console");
            });
          },
        },
      });
      return undefined;
    } finally {
      setBusy(null);
      void snapshotQuery.refetch();
    }
  }

  async function handleSend() {
    if (row.mode === "raw") {
      await withBusy("send", () =>
        sendRaw(bridge, row.agent, row.bus, {
          can_id: row.can_id ?? "",
          data: row.data ?? "",
          is_extended: row.is_extended ?? false,
          is_fd: row.is_fd ?? false,
        }),
      );
    } else {
      await withBusy("send", () =>
        sendMessage(bridge, row.agent, row.bus, {
          message: row.message ?? "",
          signals_json: JSON.stringify(row.signals ?? {}),
          mux: row.mux ?? "",
        }),
      );
    }
  }

  async function handleStart() {
    const result = await withBusy("start", async () => {
      if (row.mode === "raw") {
        return await startPeriodicRaw(bridge, row.agent, row.bus, {
          can_id: row.can_id ?? "",
          data: row.data ?? "",
          is_extended: row.is_extended ?? false,
          is_fd: row.is_fd ?? false,
          period_ms: row.period_ms,
        });
      }
      return await startPeriodicMessage(bridge, row.agent, row.bus, {
        message: row.message ?? "",
        signals_json: JSON.stringify(row.signals ?? {}),
        period_ms: row.period_ms,
        mux: row.mux ?? "",
      });
    });
    if (result?.task_id) onUpdate({ last_task_id: result.task_id });
  }

  async function handleStop() {
    if (!row.last_task_id) return;
    await withBusy("stop", () =>
      stopPeriodic(bridge, row.agent, row.bus, { task_id: row.last_task_id! }),
    );
    onUpdate({ last_task_id: null });
  }

  async function handleDelete() {
    if (isActive && row.last_task_id) {
      try {
        await stopPeriodic(bridge, row.agent, row.bus, { task_id: row.last_task_id });
      } catch {
        // Stop failed (e.g., agent already cleaned up); still remove the row
        // because the user's intent is "I don't want this anymore."
      }
    }
    setBusy("delete");
    onRemove();
  }

  const { idDisplay, dlcDisplay, messageDisplay, dataNode } = renderRowCells(row);

  return (
    <tr className="border-b border-border/50 last:border-0">
      <Td className="font-mono">
        <div className="truncate" title={typeof idDisplay === "string" ? idDisplay : undefined}>
          {idDisplay}
        </div>
      </Td>
      <Td className="text-center font-mono tabular-nums">{dlcDisplay}</Td>
      <Td>
        <div className="truncate" title={row.message ?? undefined}>
          {messageDisplay}
        </div>
      </Td>
      <Td className="font-mono text-[11px] text-muted-foreground">
        <div className="break-all">{dataNode}</div>
      </Td>
      <Td>
        <div className="flex justify-center">
          <Input
            type="number"
            min={1}
            max={60_000}
            value={periodDraft}
            onChange={(e) => setPeriodDraft(e.target.value)}
            onBlur={commitPeriod}
            className="h-6 w-16 px-1 text-center text-[11px] tabular-nums"
          />
        </div>
      </Td>
      <Td>
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSend}
            disabled={busy !== null}
            className="h-6 px-1.5 text-[11px]"
          >
            Send
          </Button>
        </div>
      </Td>
      <Td>
        <div className="flex justify-center">
          {isActive ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleStop}
              disabled={busy !== null}
              className="h-6 px-1.5 text-[11px]"
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={handleStart}
              disabled={busy !== null}
              className="h-6 px-1.5 text-[11px]"
            >
              Start
            </Button>
          )}
        </div>
      </Td>
      <Td>
        <div className="flex justify-center">
          <Button
            size="icon"
            variant="ghost"
            onClick={onEdit}
            disabled={busy !== null}
            title="Edit this message"
            className="h-6 w-6"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        </div>
      </Td>
      <Td>
        <div className="flex justify-center">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDelete}
            disabled={busy !== null}
            title="Delete this message"
            className="h-6 w-6"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </Td>
    </tr>
  );
}

/** Strip the bridge/dispatcher framing off agent action errors so toasts read
 *  cleanly. Falls back to the raw message if no known pattern matches. */
function humanizeActionError(raw: string): string {
  // Example raw: "CAN action failed: status=fail, Execution error: Python execution failed: ActionExecutionError: Signed integer value 163 out of range."
  const pythonMarker = "ActionExecutionError:";
  const idx = raw.indexOf(pythonMarker);
  if (idx >= 0) return raw.slice(idx + pythonMarker.length).trim();
  const reasonMarker = "Execution error:";
  const ridx = raw.indexOf(reasonMarker);
  if (ridx >= 0) return raw.slice(ridx + reasonMarker.length).trim();
  return raw;
}

function renderRowCells(row: TransmitRow): {
  idDisplay: string;
  dlcDisplay: string;
  messageDisplay: React.ReactNode;
  dataNode: React.ReactNode;
} {
  if (row.mode === "raw") {
    const hexChars = (row.data ?? "").replace(/[^0-9a-fA-F]/g, "");
    const dlc = Math.floor(hexChars.length / 2);
    return {
      idDisplay: row.can_id ?? "—",
      dlcDisplay: String(dlc),
      messageDisplay: <span className="text-muted-foreground">—</span>,
      dataNode: row.data?.trim() || "—",
    };
  }
  const idDisplay = row.dbc_can_id != null ? `0x${row.dbc_can_id.toString(16)}` : "—";
  const dlcDisplay = row.dbc_dlc != null ? String(row.dbc_dlc) : "—";
  const sigs = row.signals ? Object.entries(row.signals) : [];
  const tables = row.dbc_value_tables;
  return {
    idDisplay,
    dlcDisplay,
    messageDisplay: row.message ?? "—",
    dataNode:
      sigs.length === 0 ? (
        "—"
      ) : (
        <div className="space-y-0.5">
          {sigs.map(([k, v]) => (
            <div key={k}>
              {k} = {formatSignalValue(v, tables?.[k])}
            </div>
          ))}
          {row.mux ? (
            <div className="text-muted-foreground">
              {row.dbc_mux_signal ?? "mux"} ={" "}
              {formatSignalValue(
                row.mux,
                row.dbc_mux_signal ? tables?.[row.dbc_mux_signal] : undefined,
              )}
            </div>
          ) : null}
        </div>
      ),
  };
}

/** Render a signal value with its value-table label when one matches.
 *  Example: 3 + { "0": "INIT", "3": "READY" } → "READY (3)". */
function formatSignalValue(value: unknown, table: Record<string, string> | undefined): string {
  if (table) {
    const label = table[String(value)];
    if (label) return `${label} (${String(value)})`;
  }
  return String(value);
}
