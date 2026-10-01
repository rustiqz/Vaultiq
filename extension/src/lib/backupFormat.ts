import type { VaultBackup } from "./messages";

/** Thrown for any input that is not a readable backup. Message is user-facing and fixed. */
export class BackupFormatError extends Error {}

const INVALID = "That file is not a Vaultiq backup.";
const UNSUPPORTED = "This backup was made by a version of Vaultiq this build cannot read.";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function bytes(value: unknown): number[] {
  if (Array.isArray(value)) {
    const result: number[] = [];
    for (const byte of value as unknown[]) {
      if (!integer(byte) || byte < 0 || byte > 255) throw new BackupFormatError(INVALID);
      result.push(byte);
    }
    return result;
  }
  if (typeof value === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return Array.from(atob(value), char => char.charCodeAt(0));
  }
  throw new BackupFormatError(INVALID);
}

/** Converts either client's layout to the canonical extension backup without mutating input. */
export function normalizeBackup(value: unknown): VaultBackup {
  if (!record(value) || value.kind !== "vaultiq-backup") throw new BackupFormatError(INVALID);
  if (typeof value.format !== "number") throw new BackupFormatError(INVALID);
  if (value.format !== 1) throw new BackupFormatError(UNSUPPORTED);
  if (!record(value.vault) || typeof value.vault.saltB64 !== "string" || value.vault.wrappedVaultKey == null) {
    throw new BackupFormatError(INVALID);
  }
  const vault = value.vault;
  const saltB64 = vault.saltB64;
  if (typeof saltB64 !== "string") throw new BackupFormatError(INVALID);
  const nested = record(vault.argon2) ? vault.argon2 : {};
  const cost = (key: "memoryKib" | "iterations" | "parallelism"): number => {
    const flat = vault[key];
    const selected = typeof flat === "number" ? flat : nested[key];
    if (!integer(selected) || selected < 1) throw new BackupFormatError(INVALID);
    return selected;
  };
  const memoryKib = cost("memoryKib");
  const iterations = cost("iterations");
  const parallelism = cost("parallelism");
  if (!Array.isArray(value.items)) throw new BackupFormatError(INVALID);
  const items = value.items.map((item: unknown) => {
    if (!record(item) || typeof item.id !== "string" || !integer(item.format) || !integer(item.version) || typeof item.deleted !== "boolean") {
      throw new BackupFormatError(INVALID);
    }
    const item_type = typeof item.item_type === "string" ? item.item_type : item.itemType;
    const updated_at = typeof item.updated_at === "number" ? item.updated_at : item.updatedAt;
    if (typeof item_type !== "string" || typeof updated_at !== "number") throw new BackupFormatError(INVALID);
    return {
      id: item.id,
      item_type,
      format: item.format,
      ciphertext: bytes(item.ciphertext),
      nonce: bytes(item.nonce),
      version: item.version,
      updated_at,
      deleted: item.deleted,
    };
  });
  return {
    kind: "vaultiq-backup",
    format: 1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    vault: { saltB64, memoryKib, iterations, parallelism, wrappedVaultKey: vault.wrappedVaultKey },
    items,
  };
}
