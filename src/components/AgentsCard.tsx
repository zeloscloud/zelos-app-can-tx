/** Top-level inspection card: every connected agent + the CAN-extension
 *  status + each of its buses (live stats from the nested BusCard).
 *
 *  Read-only by intent — driving transmits happens in TransmitCard. Agents
 *  with the extension missing/stopped/no-buses get an inline hint with the
 *  CLI command to fix them. */

import { Copy, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BusCard } from "@/components/BusCard";
import type { AgentStatus } from "@/lib/capability";
import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";

export interface AgentsCardProps {
  bridge: BridgeTransport;
  bridgeMode: "embedded" | "standalone";
  agents: readonly AgentStatus[];
  onRefresh: () => void;
  onCopyLogs: () => void;
  toast?: string | null;
}

export function AgentsCard({
  bridge,
  bridgeMode,
  agents,
  onRefresh,
  onCopyLogs,
  toast,
}: AgentsCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Agents</CardTitle>
          <CardDescription>
            {agents.length} discovered · {bridgeMode}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {toast && <span className="text-xs text-muted-foreground">{toast}</span>}
          <Button variant="outline" size="sm" onClick={onCopyLogs} title="Copy a JSON debug snapshot to the clipboard">
            <Copy className="h-3 w-3" />
            Copy logs
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {agents.map((agent, i) => (
          <div key={agent.agent}>
            {i > 0 && <Separator className="my-4" />}
            <AgentSection bridge={bridge} agent={agent} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AgentSection({ bridge, agent }: { bridge: BridgeTransport; agent: AgentStatus }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="font-mono text-sm">{agent.agent}</code>
        <AgentBadge agent={agent} />
        {agent.extension && (
          <span className="text-xs text-muted-foreground">
            CAN ext v{agent.extension.version}
          </span>
        )}
      </div>

      {agent.kind === "ready" && agent.buses && agent.buses.length > 0 && (
        <div className="space-y-2">
          {agent.buses.map((b) => (
            <BusCard key={b.name} bridge={bridge} agent={agent.agent} bus={b.name} />
          ))}
        </div>
      )}

      {agent.kind === "extension-missing" && (
        <p className="text-xs text-muted-foreground">
          Install the CAN extension from the marketplace, or run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">
            zelos extensions install-local &lt;path-to-zelos-extension-can&gt;
          </code>{" "}
          and Refresh.
        </p>
      )}

      {agent.kind === "extension-stopped" && (
        <p className="text-xs text-muted-foreground">
          Start it via the desktop's extensions panel, or run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">
            zelos extensions start {agent.extension?.id ?? "local.can"}
          </code>{" "}
          and Refresh.
        </p>
      )}

      {agent.kind === "no-ready-buses" && agent.partialBuses && agent.partialBuses.length > 0 && (
        <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">
          {agent.partialBuses
            .map((b) => `${b.name} (missing: ${b.missing.join(", ")})`)
            .join("\n")}
        </pre>
      )}
      {agent.kind === "no-ready-buses" && (!agent.partialBuses || agent.partialBuses.length === 0) && (
        <p className="text-xs text-muted-foreground">
          The extension is running but no buses are configured. Check the extension's bus list.
        </p>
      )}
    </section>
  );
}

function AgentBadge({ agent }: { agent: AgentStatus }) {
  switch (agent.kind) {
    case "ready":
      return (
        <Badge variant="success">
          ready ({agent.buses?.length ?? 0} bus{agent.buses?.length === 1 ? "" : "es"})
        </Badge>
      );
    case "extension-stopped":
      return <Badge variant="warning">extension stopped</Badge>;
    case "no-ready-buses":
      return <Badge variant="warning">no usable buses</Badge>;
    case "extension-missing":
      return <Badge variant="destructive">extension not installed</Badge>;
  }
}
