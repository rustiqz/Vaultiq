import { useEffect, useState } from 'react';
import CryptoCore from './nativeCryptoCore';

// One clock for every code on screen. Per-row intervals each start at their
// own moment and each wait on a native round trip, so rows drifted a few
// hundred ms apart. Here a single timer fires on the real second boundary
// and hands every subscriber the same whole-second timestamp.
const listeners = new Set<(unixSecond: number) => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleNext() {
  const delay = 1000 - (Date.now() % 1000) + 5; // just past the boundary
  timer = setTimeout(() => {
    const second = Math.floor(Date.now() / 1000);
    listeners.forEach(listener => listener(second));
    scheduleNext();
  }, delay);
}

function subscribe(listener: (unixSecond: number) => void): () => void {
  listeners.add(listener);
  if (timer === null) scheduleNext();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** Ticks a TOTP code and its remaining seconds in step with every other code on screen. Shared by the Item Detail ring and the Authenticator tab's list rows. */
function useTotpCode(secretB32: string, algorithm: string, digits: number, period: number) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    let unsubscribe: (() => void) | null = null;

    const tick = async (unixSecond: number) => {
      try {
        const nextCode = await CryptoCore.totpCode(secretB32, algorithm, digits, period, unixSecond);
        if (cancelled) return;
        setCode(nextCode);
        // Pure arithmetic on the shared timestamp -- no bridge call, so it
        // is identical for every row with the same period.
        setSecondsLeft(period - (unixSecond % period));
      } catch {
        // A secret the core rejects (bad base32, under 128 bits) never
        // becomes valid by retrying -- stop ticking and say so.
        if (!cancelled) {
          setFailed(true);
          unsubscribe?.();
        }
      }
    };

    const first = Math.floor(Date.now() / 1000);
    setSecondsLeft(period - (first % period));
    tick(first);
    unsubscribe = subscribe(tick);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [secretB32, algorithm, digits, period]);

  return { code, secondsLeft, failed };
}

const TOTP_SECRET_HELP =
  "This secret can't generate codes. It must be valid base32 and at least 128 bits (26 characters).";

export { useTotpCode, TOTP_SECRET_HELP };
