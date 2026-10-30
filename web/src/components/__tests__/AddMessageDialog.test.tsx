import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BridgeTransport } from "@zeloscloud/app-extension-sdk";
import { describe, expect, it, vi } from "vitest";

import type { TransmitRow } from "@/lib/transmit-store";
import type { DbcMessage } from "@/lib/types";
import { AddMessageDialog } from "../AddMessageDialog";

const VEHICLE_STATUS: DbcMessage = {
  key: "0334_VehicleStatus",
  name: "VehicleStatus",
  can_id: 0x334,
  is_extended: false,
  dlc: 8,
  cycle_time_ms: 100,
  signals: [
    {
      name: "Speed",
      start_bit: 0,
      length: 16,
      byte_order: "little",
      is_signed: false,
      scale: 1,
      offset: 0,
    },
  ],
};

vi.mock("@/hooks/use-tx-state", () => ({ useBusSnapshot: () => ({ data: undefined }) }));
vi.mock("@/lib/can-bridge", () => ({
  listMessages: vi.fn(async () => ({ bus: "can0", messages: [VEHICLE_STATUS] })),
  describeMessage: vi.fn(async () => ({ bus: "can0", message: VEHICLE_STATUS })),
}));

describe("AddMessageDialog", () => {
  it("keeps the signals and period of a row saved with a message name", async () => {
    // A row saved from a catalog without keys holds the message name.
    const row: TransmitRow = {
      id: "r1",
      name: "VehicleStatus",
      agent: "a:1",
      bus: "can0",
      mode: "dbc",
      period_ms: 250,
      message: "VehicleStatus",
      mux: "",
      signals: { Speed: 42 },
    };
    const onSave = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AddMessageDialog
          open
          onOpenChange={vi.fn()}
          bridge={{} as BridgeTransport}
          agentAddress="a:1"
          actionPrefix="can"
          bus="can0"
          editRow={row}
          onSave={onSave}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByText("VehicleStatus").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByDisplayValue("42")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ message: "VehicleStatus", period_ms: 250, signals: { Speed: 42 } }),
      "r1",
    );
  });
});
