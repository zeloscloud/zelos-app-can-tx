/** Orchestration shell. One AgentPanel per discovered agent; a single
 *  AddMessageDialog at app level handles both add (from a panel's "+" button)
 *  and edit (from a row's pencil button). */

import { useExtensionInfo, useZelosBridge } from "@zeloscloud/app-extension-sdk/react";
import { Copy, RefreshCw } from "lucide-react";
import React from "react";

import { AddMessageDialog } from "@/components/AddMessageDialog";
import { AgentPanel } from "@/components/AgentPanel";
import { CapabilityBanner } from "@/components/CapabilityBanner";
import { Button } from "@/components/ui/button";
import { useCanDiscovery } from "@/hooks/use-capability";
import { useTransmitList } from "@/hooks/use-transmit-list";
import { copyToClipboard } from "@/lib/clipboard";
import type { NewTransmitRow, TransmitRow } from "@/lib/transmit-store";

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
  bridge: import("@zeloscloud/app-extension-sdk").BridgeTransport;
  bridgeMode: "embedded" | "standalone";
  workspaceModeKind: "NONE" | "LIVE" | "TRACEPATH" | "TRACE";
  appId: string | null;
  appVersion: string | null;
}) {
  const { discovery, isLoading, refetch } = useCanDiscovery({ bridge, workspaceModeKind });
  const { rows, addRow, updateRow, removeRow } = useTransmitList();
  const [copyToast, setCopyToast] = React.useState<string | null>(null);

  // Discriminated union: "add" carries the (agent, bus) of the panel/subcard
  // that triggered the dialog; "edit" carries the row to seed from. null = closed.
  const [dialogState, setDialogState] = React.useState<
    { mode: "add"; agent: string; bus: string } | { mode: "edit"; row: TransmitRow } | null
  >(null);

  // Resolve the open dialog's (agent address, bus) and verify the target agent
  // is still ready. If discovery changed between open and now (e.g. extension
  // stopped under our feet), the dialog won't render.
  const dialogTarget = React.useMemo(() => {
    if (!dialogState || discovery.kind !== "ready") return null;
    const address = dialogState.mode === "add" ? dialogState.agent : dialogState.row.agent;
    const bus = dialogState.mode === "add" ? dialogState.bus : dialogState.row.bus;
    const found = discovery.agents.find((a) => a.agent === address);
    if (!found || found.kind !== "ready" || !found.buses?.length) return null;
    return { agentAddress: address, bus };
  }, [dialogState, discovery]);

  const handleCopyLogs = React.useCallback(async () => {
    const log = {
      timestamp: new Date().toISOString(),
      app: { id: appId, version: appVersion },
      bridge: { mode: bridgeMode, workspaceMode: workspaceModeKind },
      discovery,
    };
    const text = JSON.stringify(log, null, 2);
    // biome-ignore lint/suspicious/noConsole: deliberate user-facing escape hatch
    console.log("[CAN-TX debug log]\n" + text);
    const ok = await copyToClipboard(text);
    setCopyToast(ok ? "Copied to clipboard" : "Clipboard blocked — see devtools console");
    window.setTimeout(() => setCopyToast(null), 2500);
  }, [appId, appVersion, bridgeMode, workspaceModeKind, discovery]);

  const handleSave = React.useCallback(
    (input: NewTransmitRow, editId: string | null) => {
      if (editId) {
        updateRow(editId, input);
      } else {
        addRow(input);
      }
    },
    [addRow, updateRow],
  );

  if (discovery.kind === "disabled") {
    return <CapabilityBanner reason={discovery.reason} onRefresh={refetch} />;
  }

  if (isLoading && discovery.agents.length === 0) {
    return <CenteredMessage>Discovering agents…</CenteredMessage>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {discovery.agents.length} agent{discovery.agents.length === 1 ? "" : "s"} · {bridgeMode}
        </p>
        <div className="flex items-center gap-2">
          {copyToast && <span className="text-xs text-muted-foreground">{copyToast}</span>}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLogs}
            title="Copy a JSON debug snapshot to the clipboard"
          >
            <Copy className="h-3 w-3" />
            Copy logs
          </Button>
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {discovery.agents.map((agent) => (
          <AgentPanel
            key={agent.agent}
            bridge={bridge}
            agent={agent}
            rows={rows.filter((r) => r.agent === agent.agent)}
            onAddClick={(a, b) => setDialogState({ mode: "add", agent: a, bus: b })}
            onEditRow={(row) => setDialogState({ mode: "edit", row })}
            onUpdateRow={updateRow}
            onRemoveRow={removeRow}
            onRefresh={refetch}
          />
        ))}
      </div>

      {dialogTarget && (
        <AddMessageDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialogState(null);
          }}
          bridge={bridge}
          agentAddress={dialogTarget.agentAddress}
          bus={dialogTarget.bus}
          editRow={dialogState?.mode === "edit" ? dialogState.row : null}
          onSave={handleSave}
        />
      )}
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
