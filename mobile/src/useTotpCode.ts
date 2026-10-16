import { useEffect, useState } from 'react';
import CryptoCore from './nativeCryptoCore';

/** Ticks a TOTP code and its remaining seconds every second. Shared by the Item Detail ring and the Authenticator tab's list rows. */
function useTotpCode(secretB32: string, algorithm: string, digits: number, period: number) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const tick = async () => {
      try {
        const now = Date.now() / 1000;
        const [nextCode, remaining] = await Promise.all([
          CryptoCore.totpCode(secretB32, algorithm, digits, period, now),
          CryptoCore.totpSecondsRemaining(period, now),
        ]);
        if (!cancelled) {
          setCode(nextCode);
          setSecondsLeft(Math.ceil(remaining));
        }
      } catch {
        // A secret the core rejects (bad base32, under 128 bits) never
        // becomes valid by retrying -- stop ticking and say so.
        if (!cancelled) {
          setFailed(true);
          clearInterval(interval);
        }
      }
    };
    const interval = setInterval(tick, 1000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [secretB32, algorithm, digits, period]);

  return { code, secondsLeft, failed };
}

const TOTP_SECRET_HELP =
  "This secret can't generate codes. It must be valid base32 and at least 128 bits (26 characters).";

export { useTotpCode, TOTP_SECRET_HELP };
