// Pure parsing/routing logic, split out from device-throttler.guard.ts so it
// stays importable (and testable) without pulling in AuthService and, with
// it, a database connection this logic itself never needs.

export const IP_ONLY_PATHS = new Set(["/auth/register", "/auth/enrollment-params", "/auth/enroll"]);

/** Splits a well-formed `Bearer <deviceId>.<credential>` header, or nothing. */
export function parseBearerCredential(
  header: string | undefined,
): { deviceId: string; credential: string } | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  const [deviceId, credential] = header.slice("Bearer ".length).split(".", 2);
  return deviceId && credential ? { deviceId, credential } : undefined;
}
