/** Shared transmit table across all (agent, bus) pairs. PCAN-style:
 *  user composes a row once via the + dialog, then drives it from the table.
 *
 *  Each row's Active/Idle state is derived from server truth — we cross-
 *  reference the row's stored `last_task_id` against the focused bus's
 *  `get_tx_state.periodics`. If the agent restarts or someone stops the
 *  periodic out-of-band, the row's button flips back to Start automatically. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { AddMessageDialog } from "@/components/AddMessageDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBusSnapshot } from "@/hooks/use-tx-state";
import { useTransmitList } from "@/hooks/use-transmit-list";
import type { AgentStatus } from "@/lib/capability";
import {
  sendMessage,
  sendRaw,
  startPeriodicMessage,
  startPeriodicRaw,
  stopPeriodic,
} from "@/lib/can-bridge";
import type { TransmitRow } from "@/lib/transmit-store";

export interface TransmitCardProps {
  bridge: BridgeTransport;
  agents: readonly AgentStatus[];
}

export function TransmitCard({ bridge, agents }: TransmitCardProps) {
  const { rows, addRow, updateRow, removeRow } = useTransmitList();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const readyAgents = React.useMemo(
    () => agents.filter((a) => a.kind === "ready" && a.buses && a.buses.length > 0),
    [agents],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Transmit</CardTitle>
          <CardDescription>
            {rows.length === 0
              ? "No messages yet — click Add to compose one."
              : `${rows.length} message${rows.length === 1 ? "" : "s"} · stored locally`}
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={readyAgents.length === 0}
          title={readyAgents.length === 0 ? "No ready agents to send to yet." : "Add a transmit message"}
        >
          <Plus className="h-4 w-4" />
          Add message
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState onAdd={() => setDialogOpen(true)} disabled={readyAgents.length === 0} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border text-left">
                  <Th>Name</Th>
                  <Th>Target</Th>
                  <Th>Type</Th>
                  <Th>Data</Th>
                  <Th className="text-right">Period</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TransmitRowView
                    key={row.id}
                    bridge={bridge}
                    row={row}
                    onUpdate={(patch) => updateRow(row.id, patch)}
                    onRemove={() => removeRow(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <AddMessageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        bridge={bridge}
        agents={agents}
        onSave={addRow}
      />
    </Card>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`py-2 px-2 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-2 px-2 align-middle ${className}`}>{children}</td>;
}

function EmptyState({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background/30 py-10 text-center text-sm text-muted-foreground">
      <p>{disabled ? "No agents are ready yet." : "Compose your first transmit message."}</p>
      <Button size="sm" variant="outline" onClick={onAdd} disabled={disabled}>
        <Plus className="h-4 w-4" />
        Add message
      </Button>
    </div>
  );
}

/** Per-row component. Owns the bus snapshot query (TanStack Query dedupes
 *  by key, so N rows on the same bus share one underlying poll). */
function TransmitRowView({
  bridge,
  row,
  onUpdate,
  onRemove,
}: {
  bridge: BridgeTransport;
  row: TransmitRow;
  onUpdate: (patch: Partial<TransmitRow>) => void;
  onRemove: () => void;
}) {
  const snapshotQuery = useBusSnapshot(bridge, row.agent, row.bus);
  const isActive = !!row.last_task_id && !!snapshotQuery.data?.bus.periodics.some((p) => p.task_id === row.last_task_id);

  const [busy, setBusy] = React.useState<"send" | "start" | "stop" | "delete" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function withBusy<T>(label: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        // If the stop fails (e.g., agent already cleaned up), still remove the
        // row — the user's intent is "I don't want this anymore."
      }
    }
    setBusy("delete");
    onRemove();
  }

  const dataPreview = previewBytes(row);

  return (
    <tr className="border-b border-border/50 last:border-0">
      <Td>
        <div className="flex items-center gap-2">
          <strong>{row.name}</strong>
          {isActive && (
            <Badge variant="success" className="text-[10px]">
              active
            </Badge>
          )}
        </div>
      </Td>
      <Td>
        <code className="text-[11px]">{row.agent}/{row.bus}</code>
      </Td>
      <Td>
        <Badge variant="outline" className="text-[10px] uppercase">
          {row.mode}
        </Badge>
      </Td>
      <Td>
        <code className="text-[11px] text-muted-foreground">{dataPreview}</code>
      </Td>
      <Td className="text-right tabular-nums">{row.period_ms} ms</Td>
      <Td>
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSend}
            disabled={busy !== null}
          >
            Send
          </Button>
          {isActive ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={handleStop}
              disabled={busy !== null}
            >
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={handleStart}
              disabled={busy !== null}
            >
              Start
            </Button>
          )}
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDelete}
            disabled={busy !== null}
            title="Delete this message"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {error && (
          <p className="mt-1 text-right text-[10px] text-destructive">{error}</p>
        )}
      </Td>
    </tr>
  );
}

function previewBytes(row: TransmitRow): string {
  if (row.mode === "raw") {
    return `${row.can_id ?? ""} · ${row.data?.trim() || "—"}`;
  }
  const sigs = row.signals ? Object.entries(row.signals) : [];
  const sigSummary = sigs.length === 0
    ? "—"
    : sigs.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(", ") +
      (sigs.length > 3 ? ` (+${sigs.length - 3} more)` : "");
  return `${row.message ?? ""} { ${sigSummary} }${row.mux ? ` mux=${row.mux}` : ""}`;
}
