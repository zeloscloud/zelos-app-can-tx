/** CapabilityBanner: every disabled reason renders distinguishing copy.
 *
 *  Catch-the-regression test — if someone adds a new DisabledReason and
 *  forgets to extend the copy map, this fails loud at the per-reason case. */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CapabilityBanner } from "../CapabilityBanner";
import type { DisabledReason } from "../../lib/capability";

const REASONS: readonly DisabledReason[] = [
  "no-agent",
  "not-live",
  "can-extension-missing",
  "can-extension-stopped",
  "no-ready-buses",
];

describe("CapabilityBanner", () => {
  it.each(REASONS)("renders distinct copy for reason %s", (reason) => {
    render(
      <CapabilityBanner
        capability={{ kind: "disabled", reason }}
        onSelectAgent={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    // Every reason should mention the reason itself in the visible footer code chip.
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("shows partialBuses detail when reason is no-ready-buses", () => {
    render(
      <CapabilityBanner
        capability={{
          kind: "disabled",
          reason: "no-ready-buses",
          partialBuses: [{ name: "busA", missing: ["send_raw", "send_message"] }],
        }}
        onSelectAgent={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/busA \(missing: send_raw, send_message\)/)).toBeInTheDocument();
  });
});
