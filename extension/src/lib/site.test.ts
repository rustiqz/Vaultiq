// The failure modes here are the ones that hand credentials to an attacker,
// so they are tested as attacks rather than as examples.

import { describe, expect, it } from "vitest";
import { matchesSite, siteScope } from "./site.js";

describe("attacks that must not match", () => {
  it("refuses a lookalike built by appending a domain", () => {
    // The classic: the stored host appears in the current one, but as a
    // prefix rather than a suffix.
    expect(matchesSite("https://google.com", "https://google.com.attacker.test")).toBe(false);
    expect(matchesSite("https://google.com", "https://login.google.com.attacker.test")).toBe(false);
  });

  it("refuses a lookalike built by prefixing without a dot", () => {
    expect(matchesSite("https://google.com", "https://notgoogle.com")).toBe(false);
    expect(matchesSite("https://example.com", "https://myexample.com")).toBe(false);
  });

  it("keeps sites on a shared platform apart", () => {
    // github.io is a public suffix: foo and bar belong to different people.
    // Without allowPrivateDomains both reduce to github.io and match.
    expect(matchesSite("https://foo.github.io", "https://bar.github.io")).toBe(false);
    expect(matchesSite("https://a.vercel.app", "https://b.vercel.app")).toBe(false);
    expect(matchesSite("https://a.s3.amazonaws.com", "https://b.s3.amazonaws.com")).toBe(false);
  });

  it("keeps different registrants under one country-code suffix apart", () => {
    expect(matchesSite("https://alpha.co.uk", "https://beta.co.uk")).toBe(false);
  });

  it("keeps different hosts apart when there is no registrable domain", () => {
    expect(matchesSite("http://192.168.1.1", "http://192.168.1.2")).toBe(false);
  });

  it("never matches an item saved without a site", () => {
    expect(matchesSite("", "https://example.com")).toBe(false);
    expect(matchesSite("   ", "https://example.com")).toBe(false);
  });

  it("never matches when the current page has no host", () => {
    expect(matchesSite("https://example.com", "about:blank")).toBe(false);
    expect(matchesSite("https://example.com", "")).toBe(false);
  });
});

describe("what should match", () => {
  it("matches across subdomains of one registrable domain", () => {
    expect(matchesSite("https://example.com", "https://account.example.com")).toBe(true);
    expect(matchesSite("https://www.example.com", "https://login.example.com")).toBe(true);
  });

  it("matches across a country-code suffix", () => {
    expect(matchesSite("https://www.example.co.uk", "https://login.example.co.uk")).toBe(true);
  });

  it("ignores scheme, port and path", () => {
    expect(matchesSite("http://example.com:8080/login?x=1", "https://example.com/account")).toBe(
      true,
    );
  });

  it("ignores case", () => {
    expect(matchesSite("https://EXAMPLE.com", "https://example.COM")).toBe(true);
  });

  it("accepts a bare hostname, which is what people type", () => {
    expect(matchesSite("example.com", "https://www.example.com")).toBe(true);
  });

  it("matches the same host when there is no registrable domain", () => {
    expect(matchesSite("http://localhost:3000", "http://localhost:8080")).toBe(true);
    expect(matchesSite("http://192.168.1.5", "http://192.168.1.5/admin")).toBe(true);
  });
});

describe("siteScope", () => {
  it("reduces to the registrable domain", () => {
    expect(siteScope("https://account.example.com/x")).toBe("example.com");
    expect(siteScope("https://www.example.co.uk")).toBe("example.co.uk");
  });

  it("keeps a platform subdomain whole", () => {
    expect(siteScope("https://foo.github.io")).toBe("foo.github.io");
  });

  it("falls back to the hostname where there is no registrable domain", () => {
    expect(siteScope("http://localhost:3000")).toBe("localhost");
    expect(siteScope("http://192.168.1.1")).toBe("192.168.1.1");
  });

  it("returns null rather than throwing on nonsense", () => {
    for (const input of ["", "   ", "not a url", "about:blank", "javascript:alert(1)"]) {
      expect(siteScope(input)).toBeNull();
    }
  });
});
