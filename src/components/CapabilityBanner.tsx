/** Shown when the capability resolver returns `disabled`.
 *
 *  One reason → one banner. The `no-agent` case shows an inline picker; every
 *  other case is informational + a refresh affordance. The disabled-state copy
 *  lives here so it stays in one place. */

import type { CanTxCapability, DisabledReason } from "../lib/capability";

const DISABLED_COPY: Record<DisabledReason, string> = {
  "no-agent": "Select an agent to enable CAN transmit.",
  "not-live": "CAN transmit requires a LIVE workspace. Switch to LIVE to continue.",
  "can-extension-missing":
    "The Zelos CAN extension is not installed on this agent. Install it from the marketplace, or run `zelos extensions install-local <path-to-zelos-extension-can>` for a local build.",
  "can-extension-stopped":
    "The CAN extension is installed but not running. Start it from the extensions panel or `zelos extensions start zeloscloud.zelos-extension-can`.",
  "no-ready-buses":
    "The CAN extension is running but no bus has the full action set required for transmit. Check the extension's bus configuration.",
};

export interface CapabilityBannerProps {
  capability: Extract<CanTxCapability, { kind: "disabled" }>;
  /** Inline agent picker for the no-agent case. Hidden when reason is anything else. */
  onSelectAgent: (agent: string) => void;
  onRefresh: () => void;
}

export function CapabilityBanner({
  capability,
  onSelectAgent,
  onRefresh,
}: CapabilityBannerProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="rounded-lg border border-border bg-card p-6 space-y-3"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        CAN transmit unavailable
      </h2>
      <p className="text-sm">{DISABLED_COPY[capability.reason]}</p>

      {capability.reason === "no-agent" && <AgentPicker onSelect={onSelectAgent} />}

      {capability.reason === "no-ready-buses" &&
        capability.partialBuses &&
        capability.partialBuses.length > 0 && (
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

/** v0: hardcoded mock agents. The real UI will source this list from the
 *  bridge once an agent-discovery primitive lands; this keeps standalone
 *  scenarios usable until then. */
function AgentPicker({ onSelect }: { onSelect: (agent: string) => void }) {
  const knownAgents = ["localhost:2300", "remote:2300"];
  return (
    <div className="flex flex-wrap gap-2">
      {knownAgents.map((a) => (
        <button
          key={a}
          type="button"
          onClick={() => onSelect(a)}
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-background"
        >
          {a}
        </button>
      ))}
    </div>
  );
}
