import {BackupFormatError, fromAnyBackup, toCanonicalBackup} from './backupFormat';
import type {InternalBackup} from './backupFormat';

// keep identical to extension/src/lib/backupFormat.test.ts
const CIPHERTEXT = [1, 2, 3, 4, 5, 6, 7, 8];                 // base64 "AQIDBAUGBwg="
const NONCE = Array.from({ length: 24 }, (_, i) => i);        // base64 "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX"
const WRAPPED = {
  version: 1,
  ciphertext: Array.from({ length: 48 }, (_, i) => 40 + i),
  nonce: NONCE,
};
export const CANONICAL = {
  kind: "vaultiq-backup", format: 1, exportedAt: "2026-01-01T00:00:00.000Z",
  vault: { saltB64: "AAAAAAAAAAAAAAAAAAAAAA==", memoryKib: 65536, iterations: 3, parallelism: 4, wrappedVaultKey: WRAPPED },
  items: [{ id: "00000000-0000-4000-8000-000000000001", item_type: "login", format: 1,
            ciphertext: CIPHERTEXT, nonce: NONCE, version: 2, updated_at: 1700000000000, deleted: false }],
};
export const MOBILE_SHAPED = {
  kind: "vaultiq-backup", format: 1, exportedAt: "2026-01-01T00:00:00.000Z",
  vault: { saltB64: "AAAAAAAAAAAAAAAAAAAAAA==", argon2: { memoryKib: 65536, iterations: 3, parallelism: 4 },
           wrappedVaultKey: { nonce: NONCE, ciphertext: WRAPPED.ciphertext, version: 1 } },
  items: [{ id: "00000000-0000-4000-8000-000000000001", itemType: "login", version: 2, updatedAt: 1700000000000,
            deleted: false, format: 1, ciphertext: "AQIDBAUGBwg=", nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYX" }],
};

const INTERNAL: InternalBackup = {
  kind: 'vaultiq-backup', format: 1, exportedAt: '2026-01-01T00:00:00.000Z',
  vault: { saltB64: 'AAAAAAAAAAAAAAAAAAAAAA==', argon2: { memoryKib: 65536, iterations: 3, parallelism: 4 }, wrappedVaultKey: WRAPPED },
  items: [{ id: '00000000-0000-4000-8000-000000000001', itemType: 'login', format: 1,
            ciphertext: 'AQIDBAUGBwg=', nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYX',
            version: 2, updatedAt: 1700000000000, deleted: false }],
};

const invalid = 'That file is not a Vaultiq backup.';
const unsupported = 'This backup was made by a version of Vaultiq this build cannot read.';
const changed = (patch: Record<string, unknown>) => ({...CANONICAL, ...patch});
const itemChanged = (patch: Record<string, unknown>) => changed({items: [{...CANONICAL.items[0], ...patch}]});

describe('backup shape conversion', () => {
  it('writes the canonical shape and reads either client shape', () => {
    expect(toCanonicalBackup(INTERNAL)).toEqual(CANONICAL);
    expect(fromAnyBackup(CANONICAL)).toEqual(INTERNAL);
    expect(fromAnyBackup(MOBILE_SHAPED)).toEqual(INTERNAL);
    expect(fromAnyBackup(toCanonicalBackup(INTERNAL))).toEqual(INTERNAL);
  });

  it('does not mutate its input', () => {
    const input = JSON.parse(JSON.stringify(MOBILE_SHAPED)) as unknown;
    const before = JSON.stringify(input);
    fromAnyBackup(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    null, 'fake', {}, {kind: 'wrong'}, changed({vault: undefined}),
    changed({vault: {...CANONICAL.vault, saltB64: undefined}}), changed({items: {}}),
  ])('rejects malformed envelopes', value => {
    expect(() => fromAnyBackup(value)).toThrow(new BackupFormatError(invalid));
  });

  it.each([
    {memoryKib: 0}, {iterations: 1.5}, {parallelism: '4'},
    {memoryKib: undefined, iterations: undefined, parallelism: undefined},
  ])('rejects invalid costs', patch => {
    expect(() => fromAnyBackup(changed({vault: {...CANONICAL.vault, ...patch}}))).toThrow(new BackupFormatError(invalid));
  });

  it.each([
    {id: undefined}, {ciphertext: [256]}, {ciphertext: [1.5]},
    {nonce: '!!!!'}, {ciphertext: 'AQIDBAUGBwg'}, {deleted: 'no'},
  ])('rejects invalid items', patch => {
    expect(() => fromAnyBackup(itemChanged(patch))).toThrow(new BackupFormatError(invalid));
  });

  it('accepts empty byte fields for the crypto core to validate', () => {
    expect(fromAnyBackup(itemChanged({ciphertext: [], nonce: []})).items[0]).toMatchObject({ciphertext: '', nonce: ''});
    expect(fromAnyBackup(itemChanged({ciphertext: '', nonce: ''})).items[0]).toMatchObject({ciphertext: '', nonce: ''});
  });

  it('distinguishes unsupported numeric formats from malformed formats', () => {
    expect(() => fromAnyBackup(changed({format: 2}))).toThrow(new BackupFormatError(unsupported));
    expect(() => fromAnyBackup(changed({format: '1'}))).toThrow(new BackupFormatError(invalid));
  });
});
