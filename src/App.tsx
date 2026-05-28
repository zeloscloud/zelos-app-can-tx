/** Orchestration shell. Owns the discovery query, the snapshot query for the
 *  focused (agent, bus), the busy/error state for in-flight mutations, and
 *  the Copy-logs button's debug snapshot. BusPanel is now presentational. */

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
import type { AgentStatus, ReadyBus } from "./lib/capability";
import type { CanBusState } from "./lib/types";

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
        appId={info?.id ?? null}
        appVersion={info?.version ?? null}
      />
    </main>
  );
}

function DiscoveryView({
  bridge,
  bridgeMode,
  workspaceModeKind,
  appId,
  appVersion,
}: {
  bridge: BridgeTransport;
  bridgeMode: "embedded" | "standalone";
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  appId: string | null;
  appVersion: string | null;
}) {
  const { discovery, isLoading, refetch } = useCanDiscovery({ bridge, workspaceModeKind });
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [selectedBus, setSelectedBus] = React.useState<string>("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [copyToast, setCopyToast] = React.useState<string | null>(null);

  // Auto-focus: prefer the first ready agent so the user lands directly in
  // the TX panel; otherwise fall back to the first agent of any status so
  // they see its AgentStatusDetail card (with the CLI hint) immediately,
  // instead of an empty hint card pointing at non-clickable chrome.
  React.useEffect(() => {
    if (discovery.kind !== "ready") return;
    if (discovery.agents.length === 0) {
      if (selectedAgent !== null) setSelectedAgent(null);
      return;
    }
    const stillThere = discovery.agents.find((a) => a.agent === selectedAgent);
    if (stillThere) return;
    const ready = discovery.agents.find((a) => a.kind === "ready");
    setSelectedAgent((ready ?? discovery.agents[0])?.agent ?? null);
  }, [discovery, selectedAgent]);

  // Compute focused agent + bus list BEFORE conditional returns so the
  // bus-selection effect runs on every render (hooks rules).
  const focusedAgent =
    discovery.kind === "ready"
      ? discovery.agents.find((a) => a.agent === selectedAgent) ?? null
      : null;
  const buses: readonly ReadyBus[] = React.useMemo(
    () => (focusedAgent?.kind === "ready" ? focusedAgent.buses ?? [] : []),
    [focusedAgent],
  );

  React.useEffect(() => {
    if (!buses.some((b) => b.name === selectedBus)) {
      setSelectedBus(buses[0]?.name ?? "");
    }
  }, [buses, selectedBus]);

  // Snapshot for the focused (agent, bus). Lifted here so the Copy-logs
  // handler can include the snapshot data + any query error in its dump.
  const snapshotQuery = useBusSnapshot(
    bridge,
    focusedAgent?.kind === "ready" ? focusedAgent.agent : null,
    selectedBus || null,
  );

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setActionError(null);
    try {
      return await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
      void snapshotQuery.refetch();
    }
  }

  const handleCopyLogs = React.useCallback(async () => {
    const log = {
      timestamp: new Date().toISOString(),
      app: { id: appId, version: appVersion },
      bridge: { mode: bridgeMode, workspaceMode: workspaceModeKind },
      discovery,
      focused: { agent: selectedAgent, bus: selectedBus },
      snapshot: {
        data: snapshotQuery.data ?? null,
        error:
          snapshotQuery.error instanceof Error
            ? snapshotQuery.error.message
            : snapshotQuery.error ?? null,
        isLoading: snapshotQuery.isLoading,
        isFetching: snapshotQuery.isFetching,
        isError: snapshotQuery.isError,
        dataUpdatedAt: snapshotQuery.dataUpdatedAt,
        errorUpdatedAt: snapshotQuery.errorUpdatedAt,
      },
      lastAction: { inFlight: busy, error: actionError },
    };
    const text = JSON.stringify(log, null, 2);
    // Always log to devtools so the user has a fallback path if the
    // clipboard call rejects (some iframe sandboxes block it).
    // biome-ignore lint/suspicious/noConsole: deliberate user-facing escape hatch
    console.log("[CAN-TX debug log]\n" + text);
    try {
      await navigator.clipboard.writeText(text);
      setCopyToast("Copied to clipboard");
    } catch {
      setCopyToast("Clipboard blocked — see devtools console");
    }
    window.setTimeout(() => setCopyToast(null), 2500);
  }, [
    appId,
    appVersion,
    bridgeMode,
    workspaceModeKind,
    discovery,
    selectedAgent,
    selectedBus,
    snapshotQuery.data,
    snapshotQuery.error,
    snapshotQuery.isLoading,
    snapshotQuery.isFetching,
    snapshotQuery.isError,
    snapshotQuery.dataUpdatedAt,
    snapshotQuery.errorUpdatedAt,
    busy,
    actionError,
  ]);

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
        onCopyLogs={handleCopyLogs}
        toast={copyToast}
      />

      {focusedAgent?.kind === "ready" && selectedBus ? (
        <BusPanel
          bridge={bridge}
          agent={focusedAgent.agent}
          bus={selectedBus}
          busState={snapshotQuery.data?.bus}
          snapshotError={snapshotQuery.error instanceof Error ? snapshotQuery.error : null}
          busy={busy}
          actionError={actionError}
          run={run}
        />
      ) : focusedAgent ? (
        <AgentStatusDetail status={focusedAgent} />
      ) : null}
    </div>
  );
}

function AgentStatusDetail({ status }: { status: AgentStatus }) {
  const headline =
    status.kind === "extension-missing"
      ? "CAN extension not installed on this agent"
      : status.kind === "extension-stopped"
        ? "CAN extension not running on this agent"
        : status.kind === "no-ready-buses"
          ? "CAN extension is running but no bus is fully usable"
          : "Ready";
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-sm space-y-2">
      <p>
        <strong>{headline}</strong>
        <span className="ml-2 text-muted-foreground">
          (<code>{status.agent}</code>)
        </span>
      </p>
      {status.kind === "extension-missing" && (
        <p className="text-xs text-muted-foreground">
          Install the CAN extension from the marketplace, or run{" "}
          <code className="rounded bg-background px-1.5 py-0.5">
            zelos extensions install-local &lt;path-to-zelos-extension-can&gt;
          </code>{" "}
          and Refresh.
        </p>
      )}
      {status.kind === "extension-stopped" && (
        <p className="text-xs text-muted-foreground">
          Start it via the desktop's extensions panel, or run{" "}
          <code className="rounded bg-background px-1.5 py-0.5">
            zelos extensions start {status.extension?.id ?? "local.can"}
          </code>{" "}
          and Refresh.
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

function BusPanel({
  bridge,
  agent,
  bus,
  busState,
  snapshotError,
  busy,
  actionError,
  run,
}: {
  bridge: BridgeTransport;
  agent: string;
  bus: string;
  busState: CanBusState | undefined;
  snapshotError: Error | null;
  busy: string | null;
  actionError: string | null;
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
}) {
  const periodics = busState?.periodics ?? [];

  return (
    <div className="space-y-4">
      <BusStatusCard busState={busState} snapshotError={snapshotError} actionError={actionError} />

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
  busState,
  snapshotError,
  actionError,
}: {
  busState: CanBusState | undefined;
  snapshotError: Error | null;
  actionError: string | null;
}) {
  // Fixed two-line area so transitions between loading / error / loaded
  // don't shift the composer + table below.
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-xs space-y-1 min-h-[3.25rem]">
      {snapshotError ? (
        <p className="text-destructive">
          Snapshot fetch failed: {snapshotError.message}. Click <strong>Refresh</strong> after
          fixing the agent-side issue.
        </p>
      ) : busState ? (
        <p>
          <strong>{busState.name}</strong> ({busState.interface}) · status {busState.status} ·
          tx_errors: {busState.metrics?.tx_errors ?? 0} · rx:{" "}
          {busState.metrics?.messages_received ?? 0}
        </p>
      ) : (
        <p className="text-muted-foreground">Loading snapshot…</p>
      )}
      {actionError && <p className="text-destructive">Last action: {actionError}</p>}
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

// Re-export so consumers can reference the type without importing from capability.ts.
export type { ReadyBus };
