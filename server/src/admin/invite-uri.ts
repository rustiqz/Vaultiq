/** The same `vaultiq://enroll` shape the extension's device-join QR uses. */
export function inviteUri(server: string, token: string): string {
  const uri = new URL("vaultiq://enroll");
  uri.searchParams.set("server", server.trim().replace(/\/+$/, ""));
  uri.searchParams.set("token", token.trim());
  uri.searchParams.set("kind", "account");
  return uri.toString();
}
