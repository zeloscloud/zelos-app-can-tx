/** Persistent chrome strip — agent + bus + status + refresh.
 *
 *  Rendered when capability is `ready`. Multi-bus shows a button-bar picker;
 *  single-bus collapses to a static label. Refresh re-runs the discovery
 *  queries (extensions.list + actions.list) and the current bus snapshot. */

import type { ReadyBus } from "../lib/capability";

export interface ConnectionBarProps {
  agent: string;
  extensionVersion: string;
  bridgeMode: "embedded" | "standalone";
  buses: readonly ReadyBus[];
  selectedBus: string;
  onSelectBus: (bus: string) => void;
  onRefresh: () => void;
}

export function ConnectionBar({
  agent,
  extensionVersion,
  bridgeMode,
  buses,
  selectedBus,
  onSelectBus,
  onRefresh,
}: ConnectionBarProps) {
  return (
    <header className="rounded-lg border border-border bg-card p-4 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs">
          <span>
            Agent: <code className="rounded bg-background px-1.5 py-0.5">{agent}</code>
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">CAN ext v{extensionVersion}</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{bridgeMode}</span>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-border px-3 py-1 text-xs hover:bg-background"
        >
          Refresh
        </button>
      </div>
      <BusPicker buses={buses} selected={selectedBus} onSelect={onSelectBus} />
    </header>
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
