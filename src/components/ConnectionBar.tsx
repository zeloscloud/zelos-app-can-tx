/** Persistent chrome strip — agent chips + bus picker + refresh.
 *
 *  The agent strip shows every agent the desktop is currently talking to,
 *  each with a status dot:
 *
 *      ● ready (clickable when not already selected)
 *      ◯ extension stopped / missing / no usable buses (display-only)
 *
 *  Multi-bus shows a button-bar picker below the agent strip; single-bus
 *  collapses to a static label. Refresh re-runs the discovery queries and
 *  the focused bus's snapshot. */

import type { AgentStatus, ReadyBus } from "../lib/capability";
import { statusLabel } from "../lib/capability";

export interface ConnectionBarProps {
  bridgeMode: "embedded" | "standalone";
  agents: readonly AgentStatus[];
  selectedAgent: string | null;
  onSelectAgent: (agent: string) => void;
  buses: readonly ReadyBus[];
  selectedBus: string;
  onSelectBus: (bus: string) => void;
  onRefresh: () => void;
}

export function ConnectionBar({
  bridgeMode,
  agents,
  selectedAgent,
  onSelectAgent,
  buses,
  selectedBus,
  onSelectBus,
  onRefresh,
}: ConnectionBarProps) {
  return (
    <header className="rounded-lg border border-border bg-card p-4 text-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {agents.length} agent{agents.length === 1 ? "" : "s"} discovered · {bridgeMode}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-border px-3 py-1 text-xs hover:bg-background"
        >
          Refresh
        </button>
      </div>
      <AgentChips agents={agents} selectedAgent={selectedAgent} onSelectAgent={onSelectAgent} />
      {buses.length > 0 && (
        <BusPicker buses={buses} selected={selectedBus} onSelect={onSelectBus} />
      )}
    </header>
  );
}

function AgentChips({
  agents,
  selectedAgent,
  onSelectAgent,
}: {
  agents: readonly AgentStatus[];
  selectedAgent: string | null;
  onSelectAgent: (agent: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs"
      role="group"
      aria-label="Connected agents"
    >
      {agents.map((a) => {
        const ready = a.kind === "ready";
        const selected = a.agent === selectedAgent;
        const classes = selected
          ? "rounded border border-border bg-background px-3 py-1 font-medium"
          : ready
            ? "rounded border border-border px-3 py-1 hover:bg-background cursor-pointer"
            : "rounded border border-border px-3 py-1 opacity-60 cursor-not-allowed";
        const handleClick = ready ? () => onSelectAgent(a.agent) : undefined;
        return (
          <button
            key={a.agent}
            type="button"
            onClick={handleClick}
            disabled={!ready}
            aria-pressed={selected}
            title={statusLabel(a)}
            className={classes}
          >
            <StatusDot kind={a.kind} /> <code className="font-mono">{a.agent}</code>
            <span className="ml-2 text-muted-foreground">· {statusLabel(a)}</span>
          </button>
        );
      })}
    </div>
  );
}

function StatusDot({ kind }: { kind: AgentStatus["kind"] }) {
  // Use raw color classes so the dot is legible regardless of theme tokens.
  const color =
    kind === "ready"
      ? "bg-green-500"
      : kind === "extension-stopped"
        ? "bg-amber-500"
        : kind === "no-ready-buses"
          ? "bg-amber-500"
          : "bg-red-500";
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full ${color}`}
    />
  );
}

function BusPicker({
  buses,
  selected,
  onSelect,
}: {
  buses: readonly ReadyBus[];
  selected: string;
  onSelect: (bus: string) => void;
}) {
  if (buses.length <= 1) {
    return (
      <p className="text-xs text-muted-foreground">
        Bus: <code>{selected || "—"}</code>
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs" role="group" aria-label="Select bus">
      <span className="text-muted-foreground">Bus:</span>
      {buses.map((b) => (
        <button
          key={b.name}
          type="button"
          onClick={() => onSelect(b.name)}
          aria-pressed={b.name === selected}
          className={
            b.name === selected
              ? "rounded border border-border bg-background px-3 py-1 font-medium"
              : "rounded border border-border px-3 py-1 hover:bg-background"
          }
        >
          {b.name}
        </button>
      ))}
    </div>
  );
}
