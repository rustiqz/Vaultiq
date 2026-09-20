// Matching an imported row against what's already in the vault, so an
// import doesn't silently create a duplicate of something already there.
//
// Two levels: an "identity" match (plausibly the same real-world login,
// card, identity, TOTP account, or note -- by the fields that actually name
// it) and, within that, an "identical" match (every field import can set
// agrees too). Only the identical case is safe to default to skipping -- a
// same-identity-different-content match (a rotated password, say) is
// surfaced to the popup, never silently merged or overwritten.

import type { DecryptedItem, ItemContent } from "./messages.js";

function norm(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function cardDigits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * The host a login URL belongs to, for matching purposes only.
 *
 * Deliberately not `site.ts`'s public-suffix-aware `siteScope`: that exists
 * to guard a trust boundary (which stored credential a page may receive), and
 * a false positive here costs nothing worse than a badge on the wrong row --
 * not worth a second `tldts` dependency in an app that doesn't otherwise need
 * one for this feature.
 */
function urlHost(url: string | undefined): string {
  const trimmed = (url ?? "").trim().toLowerCase();
  if (trimmed === "") return "";
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#]/)[0]?.split(":")[0] ?? "";
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Whether two items plausibly describe the same real-world login/card/etc. */
function sameIdentity(item: ItemContent, existing: DecryptedItem): boolean {
  if (item.type !== existing.type) return false;

  switch (item.type) {
    case "login": {
      if (existing.type !== "login") return false;
      const username = norm(item.username);
      if (username === "" || username !== norm(existing.username)) return false;
      const hostA = urlHost(item.url);
      const hostB = urlHost(existing.url);
      // No URL on either side (a CSV row with no url column, say) falls
      // back to matching on username alone rather than never matching.
      return hostA === "" || hostB === "" || hostA === hostB;
    }
    case "card": {
      if (existing.type !== "card") return false;
      const digits = cardDigits(item.number);
      return digits !== "" && digits === cardDigits(existing.number);
    }
    case "identity": {
      if (existing.type !== "identity") return false;
      const name = `${norm(item.firstName)} ${norm(item.lastName)}`.trim();
      return name !== "" && name === `${norm(existing.firstName)} ${norm(existing.lastName)}`.trim();
    }
    case "totp": {
      if (existing.type !== "totp") return false;
      const key = `${norm(item.issuer)} ${norm(item.account)}`.trim();
      return key !== "" && key === `${norm(existing.issuer)} ${norm(existing.account)}`.trim();
    }
    case "note": {
      if (existing.type !== "note") return false;
      const name = norm(item.name);
      if (name !== "") return name === norm(existing.name);
      const notes = norm(item.notes);
      return notes !== "" && notes === norm(existing.notes);
    }
  }
}

/** Whether two same-type items agree on every field an import can set. */
function sameContent(item: ItemContent, existing: DecryptedItem): boolean {
  if (item.type !== existing.type) return false;

  switch (item.type) {
    case "login":
      return (
        existing.type === "login" &&
        norm(item.username) === norm(existing.username) &&
        norm(item.password) === norm(existing.password) &&
        norm(item.url) === norm(existing.url) &&
        norm(item.notes) === norm(existing.notes) &&
        norm(item.name) === norm(existing.name) &&
        norm(item.email) === norm(existing.email) &&
        norm(item.mobile) === norm(existing.mobile)
      );
    case "card":
      return (
        existing.type === "card" &&
        cardDigits(item.number) === cardDigits(existing.number) &&
        norm(item.cardholder) === norm(existing.cardholder) &&
        norm(item.expiryMonth) === norm(existing.expiryMonth) &&
        norm(item.expiryYear) === norm(existing.expiryYear) &&
        norm(item.securityCode) === norm(existing.securityCode) &&
        norm(item.pin) === norm(existing.pin) &&
        norm(item.notes) === norm(existing.notes) &&
        norm(item.name) === norm(existing.name)
      );
    case "identity":
      return (
        existing.type === "identity" &&
        norm(item.firstName) === norm(existing.firstName) &&
        norm(item.lastName) === norm(existing.lastName) &&
        norm(item.email) === norm(existing.email) &&
        norm(item.phone) === norm(existing.phone) &&
        norm(item.street) === norm(existing.street) &&
        norm(item.street2) === norm(existing.street2) &&
        norm(item.city) === norm(existing.city) &&
        norm(item.state) === norm(existing.state) &&
        norm(item.postalCode) === norm(existing.postalCode) &&
        norm(item.country) === norm(existing.country) &&
        norm(item.company) === norm(existing.company) &&
        norm(item.dateOfBirth) === norm(existing.dateOfBirth) &&
        norm(item.nationalId) === norm(existing.nationalId) &&
        norm(item.notes) === norm(existing.notes) &&
        norm(item.name) === norm(existing.name)
      );
    case "totp":
      return (
        existing.type === "totp" &&
        norm(item.issuer) === norm(existing.issuer) &&
        norm(item.account) === norm(existing.account) &&
        norm(item.secret) === norm(existing.secret) &&
        item.algorithm === existing.algorithm &&
        item.digits === existing.digits &&
        item.period === existing.period &&
        norm(item.notes) === norm(existing.notes) &&
        norm(item.name) === norm(existing.name)
      );
    case "note":
      return existing.type === "note" && norm(item.notes) === norm(existing.notes) && norm(item.name) === norm(existing.name);
  }
}

/** What the preview shows for the existing item a row matched. */
function describeExisting(item: DecryptedItem): string {
  if (item.name !== undefined && item.name !== "") return item.name;
  if (item.type === "login") return item.username !== "" ? item.username : item.url;
  if (item.type === "card")
    return item.number !== "" ? `Card ···· ${cardDigits(item.number).slice(-4)}` : "Card";
  if (item.type === "identity") return `${item.firstName} ${item.lastName}`.trim();
  if (item.type === "totp") return `${item.issuer} ${item.account}`.trim();
  return "Note";
}

export interface DedupeMatch {
  id: string;
  label: string;
  /** Every field import can set already agrees -- safe to default to skipping. */
  identical: boolean;
}

/** The first live (non-trashed), same-identity item already in the vault, if any. */
export function findMatch(item: ItemContent, existing: DecryptedItem[]): DedupeMatch | null {
  for (const candidate of existing) {
    if (candidate.deleted) continue;
    if (!sameIdentity(item, candidate)) continue;
    return { id: candidate.id, label: describeExisting(candidate), identical: sameContent(item, candidate) };
  }
  return null;
}
