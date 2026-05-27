/** ActivePeriodicsTable: empty state + row render + stop click. */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivePeriodicsTable } from "../ActivePeriodicsTable";
import type { CanPeriodicSlot } from "../../lib/types";

const slot = (overrides: Partial<CanPeriodicSlot> = {}): CanPeriodicSlot => ({
  taskId: "0x100:std:raw",
  canId: 0x100,
  isExtended: false,
  isFd: false,
  dlc: 4,
  dataHex: "01020304",
  periodMs: 100,
  mode: "raw",
  isActive: true,
  ...overrides,
});

describe("ActivePeriodicsTable", () => {
  it("renders the empty-state copy when there are no periodics", () => {
    render(<ActivePeriodicsTable periodics={[]} busy={false} onStop={vi.fn()} />);
    expect(screen.getByText(/No active periodics/i)).toBeInTheDocument();
  });

  it("renders one row per periodic with task_id, hex CAN ID, and period", () => {
    render(
      <ActivePeriodicsTable
        periodics={[slot({ taskId: "0x100:std:raw" }), slot({ taskId: "0x200:ext:raw", canId: 0x200, isExtended: true, periodMs: 500 })]}
        busy={false}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("0x100:std:raw")).toBeInTheDocument();
    expect(screen.getByText("0x200:ext:raw")).toBeInTheDocument();
    // Extended-frame ID renders with the "(ext)" suffix to disambiguate.
    expect(screen.getByText(/0x200 \(ext\)/)).toBeInTheDocument();
    expect(screen.getByText("500 ms")).toBeInTheDocument();
  });

  it("calls onStop with the row's task_id when the stop button is clicked", () => {
    const onStop = vi.fn();
    render(
      <ActivePeriodicsTable
        periodics={[slot({ taskId: "0x300:std:raw" })]}
        busy={false}
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Stop/i }));
    expect(onStop).toHaveBeenCalledWith("0x300:std:raw");
  });

  it("disables stop buttons when busy", () => {
    render(
      <ActivePeriodicsTable
        periodics={[slot()]}
        busy={true}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Stop/i })).toBeDisabled();
  });
});
