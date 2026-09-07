import type { OtpauthUri } from './otpauth';

/**
 * Hands a QR scan result from QrScanScreen back to whichever screen opened
 * it -- a plain module-level callback rather than a route param, since
 * React Navigation's typed `navigate({..., merge: true})` can't express
 * "these params merge into ItemEdit's existing route" without widening
 * every other param on that screen to optional. Only ever one scan in
 * flight at a time, so one pending slot is enough.
 */
let pending: ((result: OtpauthUri) => void) | null = null;

/** Registers the callback for the next scan, called right before navigating to QrScan. */
export function awaitQrScan(onResult: (result: OtpauthUri) => void): void {
  pending = onResult;
}

/** Delivers a scan result and clears the slot. A no-op if nothing is waiting. */
export function resolveQrScan(result: OtpauthUri): void {
  const callback = pending;
  pending = null;
  callback?.(result);
}
