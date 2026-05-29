/** One nested card per bus on a ready agent. Owns its own 1 Hz snapshot query
 *  so the stats line ticks live without any parent coordination. */

import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { AlertCircle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useBusSnapshot } from "@/hooks/use-tx-state";

export interface BusCardProps {
  bridge: BridgeTransport;
  agent: string;
  bus: string;
}

export function BusCard({ bridge, agent, bus }: BusCardProps) {
  const snapshotQuery = useBusSnapshot(bridge, agent, bus);
  const data = snapshotQuery.data?.bus;
  const err = snapshotQuery.error instanceof Error ? snapshotQuery.error : null;

  return (
    <div className="rounded-lg border border-border bg-background/40 p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <strong className="text-sm">{data?.name ?? bus}</strong>
          <span className="text-xs text-muted-foreground">
            {data?.interface ?? "—"}
            {data?.channel ? ` · ${data.channel}` : ""}
          </span>
          {data ? (
            <StatusBadge status={data.status} />
          ) : err ? (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              snapshot error
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              loading
            </Badge>
          )}
        </div>
        {data?.dbc?.name && (
          <Badge variant="outline" className="font-mono text-[10px]">
            DBC {data.dbc.name} ({data.dbc.message_count ?? "?"} msgs)
          </Badge>
        )}
      </div>

      {err && (
        <p className="text-xs text-destructive">
          {err.message}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-5">
        <Stat label="rx" value={data?.metrics?.messages_received} />
        <Stat label="decoded" value={data?.metrics?.messages_decoded} />
        <Stat label="unknown" value={data?.metrics?.unknown_messages} />
        <Stat label="tx errors" value={data?.metrics?.tx_errors} />
        <Stat label="tx overflows" value={data?.metrics?.tx_overflows} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono">{value ?? "—"}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "active" ? "success" : status === "error" ? "destructive" : "warning";
  return <Badge variant={variant}>{status}</Badge>;
}
