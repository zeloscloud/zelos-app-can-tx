import { describe, expect, it } from "vitest";

import { findMessageByAddress, messageAddress, type DbcMessageSummary } from "./types";

const NEW_SHAPE: DbcMessageSummary[] = [
  {
    key: "0334_VehicleStatus",
    name: "VehicleStatus",
    can_id: 0x334,
    is_extended: false,
    dlc: 4,
    database: "body.dbc",
  },
  {
    key: "0352_VehicleStatus",
    name: "VehicleStatus",
    can_id: 0x352,
    is_extended: false,
    dlc: 8,
    database: "powertrain.dbc",
  },
];

const OLD_SHAPE: DbcMessageSummary[] = [
  { name: "VehicleStatus", can_id: 0x334, is_extended: false, dlc: 4 },
];

describe("messageAddress", () => {
  it("uses the key when the extension publishes one", () => {
    expect(messageAddress(NEW_SHAPE[0]!)).toBe("0334_VehicleStatus");
  });

  it("falls back to the name on a key-less catalog entry", () => {
    expect(messageAddress(OLD_SHAPE[0]!)).toBe("VehicleStatus");
  });
});

describe("picker selection", () => {
  it("tells two same-name definitions apart, and transmits the key", () => {
    for (const picked of NEW_SHAPE) {
      const address = messageAddress(picked);
      expect(address).toBe(picked.key);
      expect(findMessageByAddress(NEW_SHAPE, address)?.can_id).toBe(picked.can_id);
    }
  });

  it("transmits the bare name against a key-less catalog", () => {
    const address = messageAddress(OLD_SHAPE[0]!);
    expect(address).toBe("VehicleStatus");
    expect(findMessageByAddress(OLD_SHAPE, address)?.can_id).toBe(0x334);
  });

  it("still resolves a row saved by name before keys existed", () => {
    expect(findMessageByAddress(NEW_SHAPE, "VehicleStatus")?.can_id).toBe(0x334);
  });
});
