type EnrollmentInvite = {
  serverUrl: string;
  token: string;
};

/** Reads the deliberately small payload emitted by the trusted-device UI. */
export function parseEnrollmentQr(value: string): EnrollmentInvite | null {
  // React Native's bundled URL polyfill only derives `hostname` for HTTP(S),
  // so a WHATWG-style `new URL(value).hostname` check incorrectly rejects
  // every valid custom-scheme invite on-device.
  const match = /^vaultiq:\/\/enroll\/?\?([^#]+)$/.exec(value.trim());
  if (match?.[1] === undefined) return null;

  const params = new URLSearchParams(match[1]);
  const serverUrl = params.get('server')?.trim().replace(/\/+$/, '') ?? '';
  const token = params.get('token')?.trim() ?? '';
  if (serverUrl === '' || token === '' || token.length > 512) return null;

  try {
    const server = new URL(serverUrl);
    const local = server.hostname === 'localhost' || server.hostname === '127.0.0.1';
    if (server.protocol !== 'https:' && !(server.protocol === 'http:' && local)) return null;
    if (server.username !== '' || server.password !== '' || server.hash !== '') return null;
  } catch {
    return null;
  }

  return { serverUrl, token };
}

export type { EnrollmentInvite };
