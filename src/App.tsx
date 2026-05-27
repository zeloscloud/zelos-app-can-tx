/** v0 shell — exercises the bridge + capability resolver + mock host end-to-end.
 *
 *  Deliberately not the final PCAN-style UI (that lands in Phase 6). What this
 *  proves out for Phase 5:
 *
 *  - Bridge handshake + standalone MockBridge installation.
 *  - Capability resolver renders every disabled reason and the ready state.
 *  - A raw send + start-periodic + stop round-trip mutates `get_tx_state`.
 *
 *  When Phase 6 starts, this file becomes the wiring layer; the composer,
 *  periodics table, and connection bar move into dedicated components. */

import { useExtensionInfo, useZelosBridge } from "@zeloscloud/app-extension-sdk/react";
import React from "react";
import { useCanCapability } from "./hooks/use-capability";
import { sendRaw, startPeriodicRaw, stopPeriodic } from "./lib/can-bridge";
import type { CanTxCapability, DisabledReason } from "./lib/capability";

const DISABLED_COPY: Record<DisabledReason, string> = {
  "no-agent": "Select an agent to enable CAN transmit.",
  "not-live": "CAN transmit requires a LIVE workspace. Switch to LIVE to continue.",
  "can-extension-missing": "The Zelos CAN extension is not installed on this agent. Install it from the marketplace.",
  "can-extension-stopped": "The CAN extension is installed but not running. Start it from the extensions panel or `zelos extensions start zeloscloud.zelos-extension-can`.",
  "can-actions-missing": "The CAN extension is running but did not register the expected actions. Update the CAN extension to a version that supports the actions listed below.",
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
  const { capability, isLoading, refetch } = useCanCapability({
    bridge,
    workspaceModeKind,
    selectedAgent,
  });

  if (isLoading && capability.kind === "disabled" && capability.reason === "no-agent") {
    return <CenteredMessage>Discovering agents…</CenteredMessage>;
  }

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

      {capability.reason === "no-agent" && (
        <AgentPicker onSelectAgent={onSelectAgent} />
      )}

      {capability.reason === "can-actions-missing" && capability.missing && (
        <pre className="rounded bg-background p-3 text-xs">
          {capability.missing.map((p) => `• ${p}`).join("\n")}
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
  // v0 shell: hardcoded mock agents. Phase 6 replaces this with a real selector
  // sourced from `actions.list` / `extensions.list` fan-out keys.
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
      onRefresh();
    }
  }

  const buses = capability.state?.buses ?? [];
  const periodics = buses.flatMap((b) => b.periodics);

  return (
    <section className="space-y-4">
      <header className="rounded-lg border border-border bg-card p-4 text-sm">
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
      </header>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Buses</h2>
        {buses.length === 0 ? (
          <p className="text-xs text-muted-foreground">No buses yet — extension has not reported state.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {buses.map((b) => (
              <li key={b.name} className="flex justify-between rounded bg-background px-3 py-2">
                <span>
                  <strong>{b.name}</strong> ({b.interface}) · status {b.status}
                </span>
                <span className="text-muted-foreground">
                  tx_errors: {b.metrics?.txErrors ?? 0} · rx: {b.metrics?.messagesReceived ?? 0}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Quick send (raw)</h2>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy !== null || buses.length === 0}
            onClick={() =>
              run("send", () =>
                sendRaw(bridge, capability.agent, {
                  bus: buses[0]!.name,
                  canId: "0x100",
                  data: "01 02 03 04",
                }),
              )
            }
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background disabled:opacity-50"
          >
            Send once
          </button>
          <button
            type="button"
            disabled={busy !== null || buses.length === 0}
            onClick={() =>
              run("start-periodic", () =>
                startPeriodicRaw(bridge, capability.agent, {
                  bus: buses[0]!.name,
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
                  onClick={() => run("stop", () => stopPeriodic(bridge, capability.agent, { taskId: p.taskId }))}
                  className="rounded border border-border px-2 py-0.5 hover:bg-background disabled:opacity-50"
                >
                  Stop
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
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
