/** Pure-function tests for the transmit-row store. localStorage round-trip,
 *  name derivation, malformed-data tolerance. */

import { beforeEach, describe, expect, it } from "vitest";
import {
  createRow,
  defaultRowName,
  loadRows,
  saveRows,
  type NewTransmitRow,
} from "./transmit-store";

beforeEach(() => {
  window.localStorage.clear();
});

describe("createRow", () => {
  it("assigns a non-empty id and initializes last_task_id to null", () => {
    const row = createRow({
      name: "x",
      agent: "localhost",
      bus: "can_codec",
      mode: "raw",
      period_ms: 100,
      can_id: "0x100",
      data: "01",
    });
    expect(row.id).toBeTruthy();
    expect(row.last_task_id).toBeNull();
    expect(row.agent).toBe("localhost");
  });

  it("generates unique ids across calls", () => {
    const a = createRow({ name: "a", agent: "x", bus: "y", mode: "raw", period_ms: 100 });
    const b = createRow({ name: "b", agent: "x", bus: "y", mode: "raw", period_ms: 100 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("defaultRowName", () => {
  it("uses the DBC message name in dbc mode", () => {
    const input: NewTransmitRow = {
      name: "",
      agent: "x",
      bus: "y",
      mode: "dbc",
      period_ms: 100,
      message: "VehicleStatus",
    };
    expect(defaultRowName(input)).toBe("VehicleStatus");
  });

  it("uses the CAN ID hex in raw mode", () => {
    const input: NewTransmitRow = {
      name: "",
      agent: "x",
      bus: "y",
      mode: "raw",
      period_ms: 100,
      can_id: "0x100",
      data: "01",
    };
    expect(defaultRowName(input)).toBe("0x100");
  });
});

describe("loadRows / saveRows", () => {
  it("round-trips a list of rows through localStorage", () => {
    const a = createRow({
      name: "a",
      agent: "x",
      bus: "y",
      mode: "raw",
      period_ms: 50,
      can_id: "0x100",
      data: "01",
    });
    const b = createRow({
      name: "b",
      agent: "x",
      bus: "y",
      mode: "dbc",
      period_ms: 200,
      message: "M",
      signals: { Speed: 5 },
    });
    saveRows([a, b]);
    expect(loadRows()).toEqual([a, b]);
  });

  it("returns [] when storage is empty", () => {
    expect(loadRows()).toEqual([]);
  });

  it("filters out malformed entries instead of crashing", () => {
    const good = createRow({
      name: "ok",
      agent: "x",
      bus: "y",
      mode: "raw",
      period_ms: 100,
      can_id: "0x100",
      data: "01",
    });
    window.localStorage.setItem(
      // bypass saveRows so we can inject garbage alongside a good row
      "zelos-app-can-tx.transmit-rows.v1",
      JSON.stringify([
        good,
        { agent: "missing-id" },
        null,
        "string-not-object",
        { id: "x", agent: "x", bus: "y", mode: "not-a-real-mode" },
      ]),
    );
    expect(loadRows()).toEqual([good]);
  });

  it("returns [] when the stored value isn't JSON-parsable", () => {
    window.localStorage.setItem("zelos-app-can-tx.transmit-rows.v1", "{not json");
    expect(loadRows()).toEqual([]);
  });
});
