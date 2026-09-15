import { describe, expect, it } from 'vitest';
import { enrollmentQrPayload } from './enrollment-qr.js';

describe('enrollment QR payload', () => {
  it('round-trips the server and token without exposing either as a path', () => {
    const payload = enrollmentQrPayload('https://vault.example.test/', 'one-time-token');
    const invite = new URL(payload);

    expect(invite.protocol).toBe('vaultiq:');
    expect(invite.hostname).toBe('enroll');
    expect(invite.searchParams.get('server')).toBe('https://vault.example.test');
    expect(invite.searchParams.get('token')).toBe('one-time-token');
    // Explicit, not relied-on-by-omission: the CLI's account-creation
    // invites use the same shape with kind=account, and a scanner should
    // never have to guess which flow an invite is for.
    expect(invite.searchParams.get('kind')).toBe('device');
  });

  it('supports the USB-forwarded localhost development server', () => {
    const payload = enrollmentQrPayload('http://localhost:3000', 'abc123');
    expect(new URL(payload).searchParams.get('server')).toBe('http://localhost:3000');
  });
});
