// Base64 in and out. Small, but the item never decrypts if it is wrong: the
// ciphertext and nonce are the only fields the crypto core cannot sanity
// check for us, and a byte lost in transit fails the tag, not the parse.

import { describe, expect, it } from "vitest";
import { fromWire, toWire } from "./wire.js";
import type { StoredItem } from "../lib/vault-db.js";

const ITEM: StoredItem = {
  id: "item-1",
  item_type: "login",
  format: 1,
  // Includes 0 and 255: the ends of the range, where a sloppy conversion
  // through a string is most likely to go wrong.
  ciphertext: [0, 1, 127, 128, 254, 255],
  nonce: [255, 0, 255],
  version: 3,
  updated_at: 1_700_000_000_000,
  deleted: false,
};

describe("the wire format", () => {
  it("survives a round trip byte for byte", () => {
    expect(fromWire(toWire(ITEM))).toEqual(ITEM);
  });

  it("carries the bytes as base64, not as a list of numbers", () => {
    // A JSON array of 255s is four bytes each; this is closer to one and a
    // third, and the vault is mostly ciphertext.
    expect(toWire(ITEM).ciphertext).toBe("AAF/gP7/");
  });

  it("leaves local bookkeeping behind", () => {
    const wire = toWire({ ...ITEM, synced_version: 3, conflict_of: "other" }) as unknown as Record<
      string,
      unknown
    >;
    // These are this device's notes about the server. Sending them would have
    // the pipe reject the whole push, which is the loud failure we want.
    expect(wire.synced_version).toBeUndefined();
    expect(wire.conflict_of).toBeUndefined();
  });

  it("does not carry a tombstone's flag away", () => {
    expect(fromWire(toWire({ ...ITEM, deleted: true })).deleted).toBe(true);
  });
});
