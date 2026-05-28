/** Server-truth table of active periodics from `get_tx_state.bus.periodics`.
 *
 *  No optimistic rows; the table only ever shows what the extension reports. A
 *  parent-level "pending" indicator covers the gap between request and the
 *  next snapshot, but the row itself appears only after the agent confirms. */

import type { CanPeriodicSlot } from "../lib/types";

export interface ActivePeriodicsTableProps {
  periodics: readonly CanPeriodicSlot[];
  /** Disable individual stop buttons while a parent-coordinated mutation is in flight. */
  busy: boolean;
  onStop: (taskId: string) => Promise<void> | void;
}

export function ActivePeriodicsTable({ periodics, busy, onStop }: ActivePeriodicsTableProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h2 className="text-sm font-semibold">Active periodics</h2>

      {periodics.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active periodics.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <Th>Task ID</Th>
              <Th>CAN ID</Th>
              <Th>DLC</Th>
              <Th>Data</Th>
              <Th>Period</Th>
              <Th>Mode</Th>
              <Th>{""}</Th>
            </tr>
          </thead>
          <tbody>
            {periodics.map((p) => (
              <tr key={p.task_id} className="border-b border-border/50 last:border-0">
                <Td>
                  <code className="text-muted-foreground">{p.task_id}</code>
                </Td>
                <Td>
                  <code>
                    0x{p.can_id.toString(16)}
                    {p.is_extended ? " (ext)" : ""}
                  </code>
                </Td>
                <Td>{p.dlc}</Td>
                <Td>
                  <code className="text-muted-foreground">{p.data_hex || "—"}</code>
                </Td>
                <Td>{p.period_ms} ms</Td>
                <Td>{p.mode}</Td>
                <Td>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onStop(p.task_id)}
                    className="rounded border border-border px-2 py-0.5 hover:bg-background disabled:opacity-50"
                  >
                    Stop
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-normal py-1.5 px-2">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="py-1.5 px-2 align-middle">{children}</td>;
}
