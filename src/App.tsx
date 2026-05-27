/** v0 shell — exercises bridge + capability resolver + per-bus mock host end-to-end.
 *
 *  Not the final PCAN-style UI. What this proves out for the scaffold:
 *
 *  - Bridge handshake + standalone MockBridge installation.
 *  - Per-agent + per-bus discovery via `actions.list` keys.
 *  - Capability resolver renders every disabled reason and the ready state.
 *  - A raw send + start-periodic + stop round-trip mutates `get_tx_state`. */

import { useExtensionInfo, useZelosBridge } from "@zeloscloud/app-extension-sdk/react";
import React from "react";
import { useBusSnapshot } from "./hooks/use-tx-state";
import { useCanCapability } from "./hooks/use-capability";
import { sendRaw, startPeriodicRaw, stopPeriodic } from "./lib/can-bridge";
import type { CanTxCapability, DisabledReason, ReadyBus } from "./lib/capability";

const DISABLED_COPY: Record<DisabledReason, string> = {
  "no-agent": "Select an agent to enable CAN transmit.",
  "not-live": "CAN transmit requires a LIVE workspace. Switch to LIVE to continue.",
  "can-extension-missing": "The Zelos CAN extension is not installed on this agent. Install it from the marketplace.",
  "can-extension-stopped":
    "The CAN extension is installed but not running. Start it from the extensions panel or `zelos extensions start zeloscloud.zelos-extension-can`.",
  "no-ready-buses":
    "The CAN extension is running but no bus has the full action set required for transmit. Check the extension's bus configuration.",
};

export function App() {
  const bridge = useZelosBridge();
  const info = useExtensionInfo();
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);

  if (bridge.status === "loading") {
    return <CenteredMessage>Connecting to Zelos…</CenteredMessage>;
  }
  if (bridge.status === "error") {
    return <CenteredMessage variant="error">{bridge.error.message}</CenteredMessage>;
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">{info?.name ?? "CAN Transmit"}</h1>
        <p className="text-xs text-muted-foreground">
          {info?.id} · v{info?.version} · {bridge.mode === "standalone" ? "standalone mock" : "embedded"}
        </p>
      </header>

      <CapabilityView
        workspaceModeKind={bridge.workspace?.modeKind ?? "NONE"}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        bridge={bridge.bridge}
      />
    </main>
  );
}

function CapabilityView({
  workspaceModeKind,
  selectedAgent,
  onSelectAgent,
  bridge,
}: {
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  selectedAgent: string | null;
  onSelectAgent: (agent: string) => void;
  bridge: import("@zeloscloud/app-extension-sdk").BridgeTransport;
}) {
  const { capability, refetch } = useCanCapability({
    bridge,
    workspaceModeKind,
    selectedAgent,
  });

  if (capability.kind === "disabled") {
    return (
      <DisabledBanner
        capability={capability}
        onSelectAgent={onSelectAgent}
        onRefresh={refetch}
      />
    );
  }

  return <ReadyView capability={capability} bridge={bridge} onRefresh={refetch} />;
}

function DisabledBanner({
  capability,
  onSelectAgent,
  onRefresh,
}: {
  capability: Extract<CanTxCapability, { kind: "disabled" }>;
  onSelectAgent: (agent: string) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        CAN transmit unavailable
      </h2>
      <p className="text-sm">{DISABLED_COPY[capability.reason]}</p>

      {capability.reason === "no-agent" && <AgentPicker onSelectAgent={onSelectAgent} />}

      {capability.reason === "no-ready-buses" && capability.partialBuses && capability.partialBuses.length > 0 && (
        <pre className="rounded bg-background p-3 text-xs whitespace-pre-wrap">
          {capability.partialBuses
            .map((b) => `${b.name} (missing: ${b.missing.join(", ")})`)
            .join("\n")}
        </pre>
      )}

      <div className="flex gap-2 text-xs">
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-border px-3 py-1.5 hover:bg-background"
        >
          Refresh
        </button>
        <span className="text-muted-foreground">
          reason: <code>{capability.reason}</code>
        </span>
      </div>
    </section>
  );
}

function AgentPicker({ onSelectAgent }: { onSelectAgent: (agent: string) => void }) {
  // v0 shell: hardcoded mock agents. The final UI will source the agent list
  // from the bridge once that primitive lands; for now this is enough to
  // exercise the capability resolver in standalone mode.
  const knownAgents = ["localhost:2300", "remote:2300"];
  return (
    <div className="flex flex-wrap gap-2">
      {knownAgents.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onSelectAgent(a)}
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background"
        >
          {a}
        </button>
      ))}
    </div>
  );
}

function ReadyView({
  capability,
  bridge,
  onRefresh,
}: {
  capability: Extract<CanTxCapability, { kind: "ready" }>;
  bridge: import("@zeloscloud/app-extension-sdk").BridgeTransport;
  onRefresh: () => void;
}) {
  // Auto-select the first ready bus; the user can switch with the picker below.
  const [selectedBus, setSelectedBus] = React.useState<string>(capability.buses[0]?.name ?? "");
  React.useEffect(() => {
    if (!capability.buses.some((b) => b.name === selectedBus)) {
      setSelectedBus(capability.buses[0]?.name ?? "");
    }
  }, [capability.buses, selectedBus]);

  return (
    <section className="space-y-4">
      <header className="rounded-lg border border-border bg-card p-4 text-sm space-y-2">
        <div className="flex items-center justify-between">
          <span>
            Agent: <code>{capability.agent}</code> · Extension v{capability.extension.version}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded border border-border px-3 py-1 text-xs hover:bg-background"
          >
            Refresh
          </button>
        </div>
        <BusPicker
          buses={capability.buses}
          selected={selectedBus}
          onSelect={setSelectedBus}
        />
      </header>

      {selectedBus ? (
        <BusPanel bridge={bridge} agent={capability.agent} bus={selectedBus} />
      ) : (
        <CenteredMessage>No bus selected.</CenteredMessage>
      )}
    </section>
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
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Bus:</span>
      {buses.map((b) => (
        <button
          key={b.name}
          type="button"
          onClick={() => onSelect(b.name)}
          aria-pressed={b.name === selected}
          className={
            b.name === selected
              ? "rounded border border-border bg-background px-3 py-1"
              : "rounded border border-border px-3 py-1 hover:bg-background"
          }
        >
          {b.name}
        </button>
      ))}
    </div>
  );
}

function BusPanel({
  bridge,
  agent,
  bus,
}: {
  bridge: import("@zeloscloud/app-extension-sdk").BridgeTransport;
  agent: string;
  bus: string;
}) {
  const snapshotQuery = useBusSnapshot(bridge, agent, bus);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
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

  const busState = snapshotQuery.data?.bus;
  const periodics = busState?.periodics ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Bus status</h2>
        {!busState ? (
          <p className="text-xs text-muted-foreground">Loading snapshot…</p>
        ) : (
          <p className="text-xs">
            <strong>{busState.name}</strong> ({busState.interface}) · status {busState.status} ·
            tx_errors: {busState.metrics?.txErrors ?? 0} ·
            rx: {busState.metrics?.messagesReceived ?? 0}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Quick send (raw)</h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run("send", () =>
                sendRaw(bridge, agent, bus, { canId: "0x100", data: "01 02 03 04" }),
              )
            }
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
          >
            Send 0x100
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              run("start-periodic", () =>
                startPeriodicRaw(bridge, agent, bus, {
                  canId: "0x200",
                  data: "aa bb",
                  periodMs: 100,
                }),
              )
            }
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
          >
            Start periodic 0x200 @ 100 ms
          </button>
        </div>
        {busy && <p className="text-xs text-muted-foreground">{busy}…</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Active periodics</h2>
        {periodics.length === 0 ? (
          <p className="text-xs text-muted-foreground">No active periodics.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {periodics.map((p) => (
              <li key={p.taskId} className="flex justify-between rounded bg-background px-3 py-2">
                <span>
                  <code>{p.taskId}</code> · 0x{p.canId.toString(16)} · {p.dlc}B · {p.periodMs} ms
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run("stop", () => stopPeriodic(bridge, agent, bus, { taskId: p.taskId }))}
                  className="rounded border border-border px-2 py-0.5 hover:bg-background disabled:opacity-50"
                >
                  Stop
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CenteredMessage({
  children,
  variant = "info",
}: {
  children: React.ReactNode;
  variant?: "info" | "error";
}) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className={variant === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{children}</p>
    </div>
  );
}
