/** Orchestration shell. Step 2 of the redesign: agents/buses inspection lives
 *  in `AgentsCard` (every agent + its buses + live 1 Hz stats); transmit UI
 *  is a placeholder until step 3 (TransmitCard) lands. */

import { useExtensionInfo, useZelosBridge } from "@zeloscloud/app-extension-sdk/react";
import React from "react";

import { AgentsCard } from "@/components/AgentsCard";
import { CapabilityBanner } from "@/components/CapabilityBanner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCanDiscovery } from "@/hooks/use-capability";
import { copyToClipboard } from "@/lib/clipboard";

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
  const [copyToast, setCopyToast] = React.useState<string | null>(null);

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

  if (discovery.kind === "disabled") {
    return <CapabilityBanner reason={discovery.reason} onRefresh={refetch} />;
  }

  if (isLoading && discovery.agents.length === 0) {
    return <CenteredMessage>Discovering agents…</CenteredMessage>;
  }

  return (
    <div className="space-y-4">
      <AgentsCard
        bridge={bridge}
        bridgeMode={bridgeMode}
        agents={discovery.agents}
        onRefresh={refetch}
        onCopyLogs={handleCopyLogs}
        toast={copyToast}
      />

      <TransmitPlaceholder />
    </div>
  );
}

function TransmitPlaceholder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transmit</CardTitle>
        <CardDescription>
          Shared list of transmit messages across all ready agents and buses. Coming in the next
          commit — for now use the per-bus action surface directly via the CLI:
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">
{`zelos actions execute can/<bus>/send_raw \\
  --params '{"can_id":"0x100","data":"01 02"}'

zelos actions execute can/<bus>/start_periodic_raw \\
  --params '{"can_id":"0x200","data":"aa bb","period_ms":100}'`}
        </pre>
      </CardContent>
    </Card>
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
