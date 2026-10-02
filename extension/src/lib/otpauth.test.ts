// The secret below is RFC 6238's own published seed in base32 — the
// specification's test data, not anyone's account.

import { describe, expect, it } from "vitest";
import { parseOtpauth } from "./otpauth.js";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("parsing an otpauth URI", () => {
  it("reads the shape an authenticator actually offers", () => {
    expect(
      parseOtpauth(`otpauth://totp/Example:ada@example.test?secret=${SECRET}&issuer=Example`),
    ).toEqual({
      issuer: "Example",
      account: "ada@example.test",
      secret: SECRET,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
  });

  it("fills in RFC 6238's defaults when the URI omits them", () => {
    const parsed = parseOtpauth(`otpauth://totp/ada@example.test?secret=${SECRET}`);
    expect(parsed).toMatchObject({ algorithm: "SHA1", digits: 6, period: 30 });
    // No issuer anywhere is not an error; plenty of QR codes have none.
    expect(parsed?.issuer).toBe("");
    expect(parsed?.account).toBe("ada@example.test");
  });

  it("takes the issuer parameter over the one in the label", () => {
    // The label is a display convention; `issuer` is the field the spec tells
    // issuers to set, and they disagree often enough to matter.
    const parsed = parseOtpauth(
      `otpauth://totp/Old%20Name:ada@example.test?secret=${SECRET}&issuer=Real%20Issuer`,
    );
    expect(parsed?.issuer).toBe("Real Issuer");
  });

  it("decodes a percent-encoded label", () => {
    const parsed = parseOtpauth(`otpauth://totp/My%20Bank%3Aada%40example.test?secret=${SECRET}`);
    expect(parsed?.issuer).toBe("My Bank");
    expect(parsed?.account).toBe("ada@example.test");
  });

  it("carries non-default parameters through", () => {
    const parsed = parseOtpauth(
      `otpauth://totp/x?secret=${SECRET}&algorithm=SHA256&digits=8&period=60`,
    );
    expect(parsed).toMatchObject({ algorithm: "SHA256", digits: 8, period: 60 });
  });

  it("refuses parameters it cannot compute rather than falling back", () => {
    // A code under the wrong parameters is not a smaller problem than no
    // code: it is a code that never works, with nothing on screen to say why.
    expect(parseOtpauth(`otpauth://totp/x?secret=${SECRET}&algorithm=MD5`)).toBeNull();
    expect(parseOtpauth(`otpauth://totp/x?secret=${SECRET}&digits=4`)).toBeNull();
    expect(parseOtpauth(`otpauth://totp/x?secret=${SECRET}&digits=nine`)).toBeNull();
    expect(parseOtpauth(`otpauth://totp/x?secret=${SECRET}&period=0`)).toBeNull();
  });

  it("says nothing for what it is not", () => {
    // Each of these is a thing someone might paste. None is an error worth
    // reporting — the caller treats a bare secret as the secret.
    expect(parseOtpauth(SECRET)).toBeNull();
    expect(parseOtpauth("https://example.test")).toBeNull();
    expect(parseOtpauth(`otpauth://hotp/x?secret=${SECRET}&counter=1`)).toBeNull();
    expect(parseOtpauth("otpauth://totp/x")).toBeNull();
    expect(parseOtpauth("")).toBeNull();
  });
});
