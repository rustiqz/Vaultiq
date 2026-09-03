// Reading a card number well enough to label it.
//
// Nothing here is a validation rule. A vault holds what someone tells it to
// hold — a virtual card, a test card, a card from a scheme this file has
// never heard of — so an unrecognised number is labelled as unknown and
// stored exactly as typed, never rejected.
//
// It lives in the extension rather than the crypto core because it is
// cosmetics: how a row reads, not what anything decrypts to. When the mobile
// client arrives it moves into the shared TypeScript package alongside the
// item model, so both clients label a card the same way.

/** Issuer identification, as far as it is needed to name a scheme. */
const BRANDS: { name: string; test: RegExp }[] = [
  { name: "Visa", test: /^4/ },
  // 51–55, plus the 2221–2720 range Mastercard added in 2017.
  { name: "Mastercard", test: /^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/ },
  { name: "American Express", test: /^3[47]/ },
  { name: "Discover", test: /^(6011|65|64[4-9])/ },
  { name: "Diners Club", test: /^(36|38|30[0-5])/ },
  { name: "JCB", test: /^35(2[89]|[3-8])/ },
  { name: "UnionPay", test: /^62/ },
  { name: "RuPay", test: /^(60|65|81|82|508)/ },
];

/**
 * The digits of a card number, with the spaces and dashes people type.
 *
 * Applied on save so that the last four and any later autofill work from one
 * representation. What the user typed is not otherwise preserved: "4242 4242"
 * and "4242-4242" are the same card, and remembering which was typed would
 * only give the two ways to look different in a list.
 */
export function normalizeCardNumber(number: string): string {
  return number.replace(/[\s-]/g, "");
}

/**
 * The scheme a number belongs to, or `null` when nothing matches.
 *
 * Null is a normal answer, not a failure: it is what a gift card, a store
 * card or a scheme newer than this list produces, and all of them are things
 * a vault should hold.
 */
export function cardBrand(number: string): string | null {
  const digits = normalizeCardNumber(number);
  return BRANDS.find((brand) => brand.test.test(digits))?.name ?? null;
}

/**
 * The last four digits, which is how a card is identified out loud.
 *
 * Empty for anything too short to have four — a half-typed number, or a
 * record whose field was never filled in.
 */
export function lastFour(number: string): string {
  const digits = normalizeCardNumber(number);
  return digits.length >= 4 ? digits.slice(-4) : "";
}
