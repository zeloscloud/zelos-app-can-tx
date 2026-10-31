import type { BridgeTransport, ExtensionEntry } from "@zeloscloud/app-extension-sdk";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../AgentPanel";

const extension: ExtensionEntry = {
  id: "zeloscloud.zelos-extension-can",
  name: "CAN",
  version: "0.1.14",
  state: "running",
};

describe("AgentPanel", () => {
  it("asks for a CAN extension update when the running one is outdated", () => {
    render(
      <AgentPanel
        bridge={{} as BridgeTransport}
        agent={{ agent: "localhost:2300", kind: "extension-outdated", extension }}
        rows={[]}
        onAddClick={vi.fn()}
        onEditRow={vi.fn()}
        onUpdateRow={vi.fn()}
        onRemoveRow={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText("extension outdated")).toBeInTheDocument();
    expect(
      screen.getByText("Update the CAN extension to 0.1.15 or later, then Refresh."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/missing required actions/)).not.toBeInTheDocument();
  });
});
