/** RawComposer: validator helper coverage + form-submit happy path. */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RawComposer,
  validateCanId,
  validateData,
  validatePeriod,
} from "../RawComposer";

describe("validateCanId", () => {
  it("accepts 0x and bare hex within range", () => {
    expect(validateCanId("0x100", false)).toBeNull();
    expect(validateCanId("7ff", false)).toBeNull();
    expect(validateCanId("0x1FFFFFFF", true)).toBeNull();
  });

  it("rejects empty / non-hex / out-of-range", () => {
    expect(validateCanId("", false)).toMatch(/required/);
    expect(validateCanId("xyz", false)).toMatch(/hex/);
    expect(validateCanId("0x800", false)).toMatch(/11-bit/);
    expect(validateCanId("0x20000000", true)).toMatch(/29-bit/);
  });
});

describe("validateData", () => {
  it("accepts hex with whitespace + empty", () => {
    expect(validateData("")).toBeNull();
    expect(validateData("01")).toBeNull();
    expect(validateData("01 02 03 04")).toBeNull();
    expect(validateData("dead beef")).toBeNull();
  });

  it("rejects odd-length + non-hex", () => {
    expect(validateData("123")).toMatch(/odd/);
    expect(validateData("xy")).toMatch(/hex/);
  });
});

describe("validatePeriod", () => {
  it("accepts 1..60_000", () => {
    expect(validatePeriod(1)).toBeNull();
    expect(validatePeriod(100)).toBeNull();
    expect(validatePeriod(60_000)).toBeNull();
  });

  it("rejects bounds + NaN", () => {
    expect(validatePeriod(0)).toMatch(/≥ 1/);
    expect(validatePeriod(60_001)).toMatch(/≤ 60_000/);
    expect(validatePeriod(Number.NaN)).toMatch(/number/);
  });
});

describe("RawComposer form", () => {
  it("submits parsed frame to onSendOnce when valid", () => {
    const onSendOnce = vi.fn();
    const onStartPeriodic = vi.fn();
    render(
      <RawComposer busy={false} onSendOnce={onSendOnce} onStartPeriodic={onStartPeriodic} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Send once/i }));

    expect(onSendOnce).toHaveBeenCalledTimes(1);
    expect(onSendOnce).toHaveBeenCalledWith({
      can_id: "0x100",
      data: "01 02 03 04",
      is_extended: false,
      is_fd: false,
    });
    expect(onStartPeriodic).not.toHaveBeenCalled();
  });

  it("disables submit when busy", () => {
    const onSendOnce = vi.fn();
    render(
      <RawComposer busy={true} onSendOnce={onSendOnce} onStartPeriodic={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: /Send once/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Start periodic/i })).toBeDisabled();
  });

  it("blocks submit when CAN ID is invalid", () => {
    const onSendOnce = vi.fn();
    render(
      <RawComposer busy={false} onSendOnce={onSendOnce} onStartPeriodic={vi.fn()} />,
    );

    const canIdInput = screen.getByDisplayValue("0x100");
    fireEvent.change(canIdInput, { target: { value: "0x800" } });

    expect(screen.getByText(/11-bit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send once/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Send once/i }));
    expect(onSendOnce).not.toHaveBeenCalled();
  });
});
