// Deciding whether a stored login belongs to the site you are looking at.
//
// This is the part of a password manager that hands credentials to the wrong
// place when it is wrong, so the failure modes are worth naming:
//
//   google.com.attacker.test   must not match google.com
//   notgoogle.com              must not match google.com
//   foo.github.io              must not match bar.github.io
//
// The first two fall to any suffix comparison done at a label boundary. The
// third does not: `github.io` is a public suffix, so two unrelated people own
// `foo.github.io` and `bar.github.io`. Treating them as one site would share
// credentials between strangers.
//
// It lives here rather than in the crypto core on purpose. On mobile the
// choice is not ours — Android's Autofill Framework and iOS's Credential
// Provider decide which credentials apply, using package names and Digital
// Asset Links. Putting the Public Suffix List in the wasm bundle would add
// weight every platform pays for and only the browser uses.

import { parse } from "tldts";

/**
 * `allowPrivateDomains` is not optional here.
 *
 * tldts defaults to ICANN suffixes only, under which `foo.github.io` and
 * `bar.github.io` both reduce to `github.io` — exactly the over-match this
 * module exists to prevent. The same goes for `*.s3.amazonaws.com`,
 * `*.vercel.app` and every other platform that hands out subdomains.
 */
const TLDTS_OPTIONS = { allowPrivateDomains: true } as const;

/**
 * The scope a URL belongs to, or `null` if it has none.
 *
 * The registrable domain where there is one, so `www.example.com` and
 * `account.example.com` share a scope. Otherwise the bare hostname, which
 * covers IP addresses and `localhost` — neither has a registrable domain, and
 * falling back to exact hostname keeps `192.168.1.1` apart from
 * `192.168.1.2`.
 *
 * Scheme, port and path are ignored, so `http` and `https` on one host are
 * one site. That matches how these managers behave generally, and it does
 * mean two apps on different `localhost` ports look like one site.
 */
export function siteScope(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const parsed = parse(trimmed, TLDTS_OPTIONS);
  return (parsed.domain ?? parsed.hostname)?.toLowerCase() ?? null;
}

/**
 * Whether a stored login belongs to the page currently open.
 *
 * A URL with no recognisable host never matches — including the empty string,
 * so an item saved without a site is never offered anywhere.
 */
export function matchesSite(storedUrl: string, currentUrl: string): boolean {
  const stored = siteScope(storedUrl);
  const current = siteScope(currentUrl);
  return stored !== null && current !== null && stored === current;
}
