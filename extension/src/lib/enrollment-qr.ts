/** Stable payload scanned by the mobile Join Vault flow. */
export function enrollmentQrPayload(server: string, token: string): string {
  const invite = new URL('vaultiq://enroll');
  invite.searchParams.set('server', server.trim().replace(/\/+$/, ''));
  invite.searchParams.set('token', token.trim());
  return invite.toString();
}
