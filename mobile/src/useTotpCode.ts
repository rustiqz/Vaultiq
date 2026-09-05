import { useEffect, useState } from 'react';
import CryptoCore from './nativeCryptoCore';

/** Ticks a TOTP code and its remaining seconds every second. Shared by the Item Detail ring and the Authenticator tab's list rows. */
function useTotpCode(secretB32: string, algorithm: string, digits: number, period: number) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const now = Date.now() / 1000;
      const [nextCode, remaining] = await Promise.all([
        CryptoCore.totpCode(secretB32, algorithm, digits, period, now),
        CryptoCore.totpSecondsRemaining(period, now),
      ]);
      if (!cancelled) {
        setCode(nextCode);
        setSecondsLeft(Math.ceil(remaining));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [secretB32, algorithm, digits, period]);

  return { code, secondsLeft };
}

export { useTotpCode };
