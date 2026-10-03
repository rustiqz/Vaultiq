# Authenticator codes

Vaultiq can hold time-based one-time passcode (TOTP) secrets and show the
6-digit codes, the same as an authenticator app. Codes are computed in the
shared Rust core and checked against RFC 6238's published test vectors.

## Add an account

- **Paste an `otpauth://` link.** The link an issuer shows beside its QR code
  carries the algorithm, digit count and period, so nothing is guessed.
- **Type the secret.** Anything under 16 bytes is refused as too short.
- **Scan a QR code (Android).** The Codes tab, and the new item form, open the
  camera.

## Using codes

On Android the **Codes** tab lists every authenticator account with its live
code and a countdown ring. Tap a code to copy it; the clipboard clears after 30
seconds. Codes are grouped by account.

In the extension, an authenticator item autofills into a one-time-code field on
the page.

## A caution

Keeping your passwords and your second factor in the same vault means one
master password protects both. That is a trade-off, not a flaw, but decide on
it deliberately for your most important accounts.
