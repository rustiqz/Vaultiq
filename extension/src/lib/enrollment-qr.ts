/**
 * Stable payload scanned by the mobile Join Vault flow.
 *
 * `kind=device` is explicit rather than relied-on-by-omission: the CLI's
 * account-creation invites (server/src/admin/cli.ts) use the same
 * `vaultiq://enroll` shape with `kind=account`, and a scanner should never
 * have to guess which flow an invite is for.
 */
export function enrollmentQrPayload(server: string, token: string): string {
  const invite = new URL('vaultiq://enroll');
  invite.searchParams.set('server', server.trim().replace(/\/+$/, ''));
  invite.searchParams.set('token', token.trim());
  invite.searchParams.set('kind', 'device');
  return invite.toString();
}
