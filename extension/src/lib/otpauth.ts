// Reading the `otpauth://` URI behind a QR code.
//
// Nobody types a base32 secret willingly, and every authenticator's setup
// page offers this string as the manual alternative to scanning. Accepting it
// whole is the difference between adding an account in one paste and
// transcribing thirty-two characters by eye.
//
// The parse is deliberately forgiving about what it does not understand and
// strict about what it does: an unknown query parameter is ignored, but an
// algorithm or digit count this build cannot compute is a refusal rather than
// a silent fallback to the defaults. A code computed under the wrong
// parameters is not a smaller problem than no code at all.

import type { TotpAlgorithmName } from "./messages.js";

export interface OtpauthUri {
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithmName;
  digits: number;
  period: number;
}

const ALGORITHMS: TotpAlgorithmName[] = ["SHA1", "SHA256", "SHA512"];

/** RFC 6238's defaults, which is what a URI means when it omits these. */
export const TOTP_DEFAULTS = { algorithm: "SHA1" as TotpAlgorithmName, digits: 6, period: 30 };

/**
 * Parses an `otpauth://totp/...` URI, or returns null.
 *
 * Null covers everything that is not one of these: a bare base32 secret, a
 * URL to somewhere else, an `otpauth://hotp/` counter-based account this
 * build does not support. The caller decides what to do about it — for a
 * pasted secret, treating the input as the secret itself is exactly right.
 */
export function parseOtpauth(input: string): OtpauthUri | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  // `hostname` is empty for otpauth:// in some parsers, so the type is read
  // from the path instead, where it is always the first segment.
  if (url.protocol !== "otpauth:") return null;
  const path = `${url.host}${url.pathname}`;
  const [kind, ...rest] = path.split("/").filter(Boolean);
  if (kind?.toLowerCase() !== "totp") return null;

  const secret = url.searchParams.get("secret")?.replace(/\s/g, "") ?? "";
  if (!secret) return null;

  // The label is "Issuer:account" or just "account", and it arrives
  // percent-encoded. A colon may also be written as %3A, which decodeURI
  // has already turned back by the time we split.
  const label = decodeURIComponent(rest.join("/"));
  const separator = label.indexOf(":");
  const labelIssuer = separator === -1 ? "" : label.slice(0, separator).trim();
  const account = (separator === -1 ? label : label.slice(separator + 1)).trim();

  // The query parameter wins: the label is a display convention, while
  // `issuer` is the field the spec tells issuers to set.
  const issuer = url.searchParams.get("issuer")?.trim() || labelIssuer;

  const named = url.searchParams.get("algorithm")?.toUpperCase();
  const algorithm = named
    ? ALGORITHMS.find((candidate) => candidate === named)
    : TOTP_DEFAULTS.algorithm;
  if (!algorithm) return null;

  const digits = whole(url.searchParams.get("digits"), TOTP_DEFAULTS.digits);
  if (digits === null || digits < 6 || digits > 8) return null;

  const period = whole(url.searchParams.get("period"), TOTP_DEFAULTS.period);
  if (period === null || period < 1) return null;

  return { issuer, account, secret, algorithm, digits, period };
}

/** A positive whole number, the fallback when absent, or null when nonsense. */
function whole(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}
