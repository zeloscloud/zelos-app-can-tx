/** Orchestration shell. Owns the (agent, bus) selection and the busy/error
 *  state for in-flight mutations; everything else lives in `components/`. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useExtensionInfo, useZelosBridge } from "@zeloscloud/app-extension-sdk/react";
import React from "react";
import { ActivePeriodicsTable } from "./components/ActivePeriodicsTable";
import { CapabilityBanner } from "./components/CapabilityBanner";
import { ConnectionBar } from "./components/ConnectionBar";
import { RawComposer, type ParsedFrame } from "./components/RawComposer";
import { useCanCapability } from "./hooks/use-capability";
import { useBusSnapshot } from "./hooks/use-tx-state";
import { sendRaw, startPeriodicRaw, stopPeriodic } from "./lib/can-bridge";
import type { CanTxCapability } from "./lib/capability";

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
    <main className="min-h-screen bg-background p-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{info?.name ?? "CAN Transmit"}</h1>
        <p className="text-xs text-muted-foreground">
          {info?.id} · v{info?.version}
        </p>
      </header>

      <CapabilityView
        bridge={bridge.bridge}
        bridgeMode={bridge.mode}
        workspaceModeKind={bridge.workspace?.modeKind ?? "NONE"}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
      />
    </main>
  );
}

function CapabilityView({
  bridge,
  bridgeMode,
  workspaceModeKind,
  selectedAgent,
  onSelectAgent,
}: {
  bridge: BridgeTransport;
  bridgeMode: "embedded" | "standalone";
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  selectedAgent: string | null;
  onSelectAgent: (agent: string) => void;
}) {
  const { capability, refetch } = useCanCapability({
    bridge,
    workspaceModeKind,
    selectedAgent,
  });

  if (capability.kind === "disabled") {
    return (
      <CapabilityBanner
        capability={capability}
        onSelectAgent={onSelectAgent}
        onRefresh={refetch}
      />
    );
  }

  return (
    <ReadyView
      capability={capability}
      bridge={bridge}
      bridgeMode={bridgeMode}
      onRefresh={refetch}
    />
  );
}

function ReadyView({
  capability,
  bridge,
  bridgeMode,
  onRefresh,
}: {
  capability: Extract<CanTxCapability, { kind: "ready" }>;
  bridge: BridgeTransport;
  bridgeMode: "embedded" | "standalone";
  onRefresh: () => void;
}) {
  // Auto-select the first ready bus; user can switch via ConnectionBar's picker.
  const [selectedBus, setSelectedBus] = React.useState<string>(capability.buses[0]?.name ?? "");
  React.useEffect(() => {
    if (!capability.buses.some((b) => b.name === selectedBus)) {
      setSelectedBus(capability.buses[0]?.name ?? "");
    }
  }, [capability.buses, selectedBus]);

  return (
    <div className="space-y-4">
      <ConnectionBar
        agent={capability.agent}
        extensionVersion={capability.extension.version}
        bridgeMode={bridgeMode}
        buses={capability.buses}
        selectedBus={selectedBus}
        onSelectBus={setSelectedBus}
        onRefresh={onRefresh}
      />

      {selectedBus ? (
        <BusPanel bridge={bridge} agent={capability.agent} bus={selectedBus} />
      ) : (
        <CenteredMessage>No bus selected.</CenteredMessage>
      )}
    </div>
  );
}

function BusPanel({
  bridge,
  agent,
  bus,
}: {
  bridge: BridgeTransport;
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
      <BusStatusCard busy={busy} error={error} busState={busState} />

      <RawComposer
        busy={busy !== null}
        onSendOnce={(p: ParsedFrame) =>
          run("send", () => sendRaw(bridge, agent, bus, p))
        }
        onStartPeriodic={async (p) => {
          await run("start-periodic", () => startPeriodicRaw(bridge, agent, bus, p));
        }}
      />

      <ActivePeriodicsTable
        periodics={periodics}
        busy={busy !== null}
        onStop={(taskId) =>
          run("stop", () => stopPeriodic(bridge, agent, bus, { taskId }))
        }
      />
    </div>
  );
}

function BusStatusCard({
  busy,
  error,
  busState,
}: {
  busy: string | null;
  error: string | null;
  busState:
    | {
        name: string;
        interface: string;
        status: string;
        metrics?: { txErrors?: number; messagesReceived?: number };
      }
    | undefined;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-xs space-y-1">
      {busState ? (
        <p>
          <strong>{busState.name}</strong> ({busState.interface}) · status {busState.status} ·
          tx_errors: {busState.metrics?.txErrors ?? 0} · rx:{" "}
          {busState.metrics?.messagesReceived ?? 0}
        </p>
      ) : (
        <p className="text-muted-foreground">Loading snapshot…</p>
      )}
      {busy && <p className="text-muted-foreground">{busy}…</p>}
      {error && <p className="text-destructive">{error}</p>}
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
    <div className="flex min-h-[40vh] items-center justify-center">
      <p
        className={
          variant === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"
        }
      >
        {children}
      </p>
    </div>
  );
}
