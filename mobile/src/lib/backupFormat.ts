import type { EncryptedItem } from '../nativeCryptoCore';
import type { VaultRecord } from '../storage';

declare function atob(value: string): string;
declare function btoa(value: string): string;

export class BackupFormatError extends Error {}

/** Mobile's in-memory backup: internal item/vault types. */
export interface InternalBackup {
  kind: 'vaultiq-backup';
  format: number;
  exportedAt: string;
  vault: VaultRecord;
  items: EncryptedItem[];
}

/** The canonical file layout (ADR-1). */
export interface CanonicalBackup {
  kind: 'vaultiq-backup';
  format: number;
  exportedAt: string;
  vault: { saltB64: string; memoryKib: number; iterations: number; parallelism: number; wrappedVaultKey: unknown };
  items: {
    id: string; item_type: string; format: number; ciphertext: number[]; nonce: number[];
    version: number; updated_at: number; deleted: boolean;
  }[];
}

const INVALID = 'That file is not a Vaultiq backup.';
const UNSUPPORTED = 'This backup was made by a version of Vaultiq this build cannot read.';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function normalizedBytes(value: unknown): string {
  if (Array.isArray(value)) {
    const bytes: number[] = [];
    for (const byte of value as unknown[]) {
      if (!integer(byte) || byte < 0 || byte > 255) throw new BackupFormatError(INVALID);
      bytes.push(byte);
    }
    // Chunked: spreading one argument per byte can exceed the engine's
    // argument limit for a large ciphertext (e.g. a big secure note).
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.slice(i, i + 8192));
    }
    return btoa(binary);
  }
  if (typeof value === 'string' && BASE64.test(value)) return value;
  throw new BackupFormatError(INVALID);
}

function decodeBytes(value: string): number[] {
  return Array.from(atob(value), char => char.charCodeAt(0));
}

/** Internal → canonical file. base64 → number[]; camelCase → snake_case; nested argon2 → flat. */
export function toCanonicalBackup(backup: InternalBackup): CanonicalBackup {
  return {
    kind: 'vaultiq-backup', format: 1, exportedAt: backup.exportedAt,
    vault: {
      saltB64: backup.vault.saltB64,
      memoryKib: backup.vault.argon2.memoryKib,
      iterations: backup.vault.argon2.iterations,
      parallelism: backup.vault.argon2.parallelism,
      wrappedVaultKey: backup.vault.wrappedVaultKey,
    },
    items: backup.items.map(item => ({
      id: item.id, item_type: item.itemType, format: item.format,
      ciphertext: decodeBytes(item.ciphertext), nonce: decodeBytes(item.nonce),
      version: item.version, updated_at: item.updatedAt, deleted: item.deleted,
    })),
  };
}

/** Accepts either backup layout and returns validated mobile internal types. */
export function fromAnyBackup(value: unknown): InternalBackup {
  if (!record(value) || value.kind !== 'vaultiq-backup') throw new BackupFormatError(INVALID);
  if (typeof value.format !== 'number') throw new BackupFormatError(INVALID);
  if (value.format !== 1) throw new BackupFormatError(UNSUPPORTED);
  if (!record(value.vault) || typeof value.vault.saltB64 !== 'string' || value.vault.wrappedVaultKey == null) {
    throw new BackupFormatError(INVALID);
  }
  const vault = value.vault;
  const saltB64 = vault.saltB64;
  if (typeof saltB64 !== 'string') throw new BackupFormatError(INVALID);
  const nested = record(vault.argon2) ? vault.argon2 : {};
  const cost = (key: 'memoryKib' | 'iterations' | 'parallelism'): number => {
    const flat = vault[key];
    const selected = typeof flat === 'number' ? flat : nested[key];
    if (!integer(selected) || selected < 1) throw new BackupFormatError(INVALID);
    return selected;
  };
  const memoryKib = cost('memoryKib');
  const iterations = cost('iterations');
  const parallelism = cost('parallelism');
  if (!Array.isArray(value.items)) throw new BackupFormatError(INVALID);
  const items = value.items.map((item: unknown) => {
    if (!record(item) || typeof item.id !== 'string' || !integer(item.format) || !integer(item.version) || typeof item.deleted !== 'boolean') {
      throw new BackupFormatError(INVALID);
    }
    const itemType = typeof item.item_type === 'string' ? item.item_type : item.itemType;
    const updatedAt = typeof item.updated_at === 'number' ? item.updated_at : item.updatedAt;
    if (typeof itemType !== 'string' || typeof updatedAt !== 'number') throw new BackupFormatError(INVALID);
    return {
      id: item.id, itemType, format: item.format,
      ciphertext: normalizedBytes(item.ciphertext), nonce: normalizedBytes(item.nonce),
      version: item.version, updatedAt, deleted: item.deleted,
    };
  });
  return {
    kind: 'vaultiq-backup', format: 1,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    vault: { saltB64, argon2: { memoryKib, iterations, parallelism }, wrappedVaultKey: vault.wrappedVaultKey as VaultRecord['wrappedVaultKey'] },
    items,
  };
}
