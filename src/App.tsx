/** Orchestration shell. Multi-agent discovery is automatic; the UI auto-focuses
 *  the sole ready agent when there's only one and offers a picker for many.
 *  No "connect agent" dance — every agent the desktop is talking to shows up. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { useExtensionInfo, useZelosBridge } from "@zeloscloud/app-extension-sdk/react";
import React from "react";
import { ActivePeriodicsTable } from "./components/ActivePeriodicsTable";
import { CapabilityBanner } from "./components/CapabilityBanner";
import { ConnectionBar } from "./components/ConnectionBar";
import { RawComposer, type ParsedFrame } from "./components/RawComposer";
import { useCanDiscovery } from "./hooks/use-capability";
import { useBusSnapshot } from "./hooks/use-tx-state";
import { sendRaw, startPeriodicRaw, stopPeriodic } from "./lib/can-bridge";
import { statusLabel, type AgentStatus, type ReadyBus } from "./lib/capability";

export function App() {
  const bridge = useZelosBridge();
  const info = useExtensionInfo();

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

      <DiscoveryView
        bridge={bridge.bridge}
        bridgeMode={bridge.mode}
        workspaceModeKind={bridge.workspace?.modeKind ?? "NONE"}
      />
    </main>
  );
}

function DiscoveryView({
  bridge,
  bridgeMode,
  workspaceModeKind,
}: {
  bridge: BridgeTransport;
  bridgeMode: "embedded" | "standalone";
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
}) {
  const { discovery, isLoading, refetch } = useCanDiscovery({ bridge, workspaceModeKind });
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [selectedBus, setSelectedBus] = React.useState<string>("");

  // Auto-focus a ready agent when (a) nothing's selected yet or (b) the
  // previously-selected agent disappeared or changed status. Default to the
  // first ready one in the sorted-by-address list.
  React.useEffect(() => {
    if (discovery.kind !== "ready") return;
    const ready = discovery.agents.filter((a) => a.kind === "ready");
    if (ready.length === 0) {
      if (selectedAgent !== null) setSelectedAgent(null);
      return;
    }
    const current = ready.find((a) => a.agent === selectedAgent);
    if (!current) {
      setSelectedAgent(ready[0]?.agent ?? null);
    }
  }, [discovery, selectedAgent]);

  // Compute the focused agent + its bus list before any conditional returns
  // so the bus-selection effect runs on every render path (hooks rules).
  const focusedAgent =
    discovery.kind === "ready"
      ? discovery.agents.find((a) => a.agent === selectedAgent) ?? null
      : null;
  const buses: readonly ReadyBus[] = React.useMemo(
    () => (focusedAgent?.kind === "ready" ? focusedAgent.buses ?? [] : []),
    [focusedAgent],
  );

  // Reset bus selection when the focused agent changes or its bus list shifts.
  React.useEffect(() => {
    if (!buses.some((b) => b.name === selectedBus)) {
      setSelectedBus(buses[0]?.name ?? "");
    }
  }, [buses, selectedBus]);

  if (discovery.kind === "disabled") {
    return <CapabilityBanner reason={discovery.reason} onRefresh={refetch} />;
  }

  if (isLoading && discovery.agents.length === 0) {
    return <CenteredMessage>Discovering agents…</CenteredMessage>;
  }

  return (
    <div className="space-y-4">
      <ConnectionBar
        bridgeMode={bridgeMode}
        agents={discovery.agents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        buses={buses}
        selectedBus={selectedBus}
        onSelectBus={setSelectedBus}
        onRefresh={refetch}
      />

      {focusedAgent?.kind === "ready" && selectedBus ? (
        <BusPanel bridge={bridge} agent={focusedAgent.agent} bus={selectedBus} />
      ) : focusedAgent && focusedAgent.kind !== "ready" ? (
        <AgentStatusDetail status={focusedAgent} />
      ) : (
        <NoReadyAgentsHint discovery={discovery} />
      )}
    </div>
  );
}

function AgentStatusDetail({ status }: { status: AgentStatus }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-sm space-y-2">
      <p>
        <code>{status.agent}</code> · {statusLabel(status)}
      </p>
      {status.kind === "extension-missing" && (
        <p className="text-xs text-muted-foreground">
          Install the CAN extension from the marketplace, or run{" "}
          <code className="rounded bg-background px-1.5 py-0.5">
            zelos extensions install-local &lt;path-to-zelos-extension-can&gt;
          </code>{" "}
          and refresh.
        </p>
      )}
      {status.kind === "extension-stopped" && (
        <p className="text-xs text-muted-foreground">
          Start the extension via the extensions panel or{" "}
          <code className="rounded bg-background px-1.5 py-0.5">
            zelos extensions start {status.extension?.id ?? "local.can"}
          </code>
          .
        </p>
      )}
      {status.kind === "no-ready-buses" && status.partialBuses && status.partialBuses.length > 0 && (
        <pre className="rounded bg-background p-3 text-xs whitespace-pre-wrap">
          {status.partialBuses.map((b) => `${b.name} (missing: ${b.missing.join(", ")})`).join("\n")}
        </pre>
      )}
    </section>
  );
}

function NoReadyAgentsHint({
  discovery,
}: {
  discovery: Extract<ReturnType<typeof useCanDiscovery>["discovery"], { kind: "ready" }>;
}) {
  const allMissing = discovery.agents.every((a) => a.kind === "extension-missing");
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-sm space-y-2">
      <p className="text-muted-foreground">
        {allMissing
          ? "None of the connected agents have the CAN extension installed."
          : "No agent is ready for TX yet — click a chip above for status details."}
      </p>
    </section>
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
        onSendOnce={(p: ParsedFrame) => run("send", () => sendRaw(bridge, agent, bus, p))}
        onStartPeriodic={async (p) => {
          await run("start-periodic", () => startPeriodicRaw(bridge, agent, bus, p));
        }}
      />

      <ActivePeriodicsTable
        periodics={periodics}
        busy={busy !== null}
        onStop={(taskId) => run("stop", () => stopPeriodic(bridge, agent, bus, { task_id: taskId }))}
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
  busState: import("./lib/types").CanBusState | undefined;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-xs space-y-1">
      {busState ? (
        <p>
          <strong>{busState.name}</strong> ({busState.interface}) · status {busState.status} ·
          tx_errors: {busState.metrics?.tx_errors ?? 0} · rx:{" "}
          {busState.metrics?.messages_received ?? 0}
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

// Re-export this so consumers (tests, etc.) don't need to know about the
// inner type structure. Currently unused; keep for future component tests.
export type { ReadyBus };
