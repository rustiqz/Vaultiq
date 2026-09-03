// The numbers below are the schemes' own published test numbers — they are
// documentation, not anyone's card (CLAUDE.md §2.6).

import { describe, expect, it } from "vitest";
import { cardBrand, lastFour, normalizeCardNumber } from "./card.js";

describe("normalizing", () => {
  it("drops the spaces and dashes people type", () => {
    expect(normalizeCardNumber("4242 4242 4242 4242")).toBe("4242424242424242");
    expect(normalizeCardNumber("4242-4242-4242-4242")).toBe("4242424242424242");
  });

  it("leaves anything else alone", () => {
    // Not a validator: whatever is stored comes back.
    expect(normalizeCardNumber("gift-card-code")).toBe("giftcardcode");
  });
});

describe("naming the scheme", () => {
  it("recognises the common ones", () => {
    expect(cardBrand("4242 4242 4242 4242")).toBe("Visa");
    expect(cardBrand("5555555555554444")).toBe("Mastercard");
    expect(cardBrand("378282246310005")).toBe("American Express");
    expect(cardBrand("6011111111111117")).toBe("Discover");
    expect(cardBrand("3056930009020004")).toBe("Diners Club");
    expect(cardBrand("3566002020360505")).toBe("JCB");
    expect(cardBrand("6200000000000005")).toBe("UnionPay");
  });

  it("recognises the 2-series Mastercard added in 2017", () => {
    expect(cardBrand("2223003122003222")).toBe("Mastercard");
  });

  it("says nothing rather than guessing", () => {
    // A gift card, a store card, a scheme newer than this list. All of them
    // are things a vault should hold, so an unknown number is not an error.
    expect(cardBrand("9999999999999999")).toBeNull();
    expect(cardBrand("")).toBeNull();
  });
});

describe("the last four", () => {
  it("is how a card is identified out loud", () => {
    expect(lastFour("4242 4242 4242 4242")).toBe("4242");
  });

  it("is empty for anything too short to have four", () => {
    expect(lastFour("424")).toBe("");
    expect(lastFour("")).toBe("");
  });
});
