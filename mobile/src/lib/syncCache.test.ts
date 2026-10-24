import { createLock, loadThenRefresh, mergeEncrypted } from './syncCache';
import type { EncryptedItem } from '../nativeCryptoCore';

// Test-only fixtures: obviously fake ciphertext.
const item = (id: string, version: number, ciphertext = 'AAAA'): EncryptedItem => ({
  id,
  itemType: 'login',
  format: 1,
  ciphertext,
  nonce: 'AAAA',
  version,
  updatedAt: 0,
  deleted: false,
});

describe('mergeEncrypted', () => {
  it('adds new ids and keeps the rest', () => {
    const merged = mergeEncrypted([item('a', 1)], [item('b', 1)]);
    expect(merged.map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('takes a newer version', () => {
    expect(mergeEncrypted([item('a', 1)], [item('a', 2)])[0]?.version).toBe(2);
  });

  it('never lets an older arrival replace a newer cached item', () => {
    // A pull that started before a local push finished.
    expect(mergeEncrypted([item('a', 3, 'NEW=')], [item('a', 2, 'OLD=')])[0]?.ciphertext).toBe('NEW=');
  });

  it('takes the incoming copy on an equal version', () => {
    expect(mergeEncrypted([item('a', 2, 'OLD=')], [item('a', 2, 'NEW=')])[0]?.ciphertext).toBe('NEW=');
  });
});

describe('createLock', () => {
  it('runs read-modify-write sequences one at a time, even after a failure', async () => {
    const lock = createLock();
    let value = 0;
    const bump = () =>
      lock(async () => {
        const read = value;
        await Promise.resolve();
        value = read + 1;
      });
    await Promise.all([bump(), bump(), bump()]);
    expect(value).toBe(3);

    await expect(lock(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock(async () => 'still works')).resolves.toBe('still works');
  });
});

describe('loadThenRefresh', () => {
  it('draws from the device first and does not redraw when nothing is new', async () => {
    const seen: string[][] = [];
    await loadThenRefresh(
      { loadItems: async () => ['a'], refreshItems: async () => null },
      items => seen.push(items),
    );
    expect(seen).toEqual([['a']]);
  });

  it('redraws when the sync found news', async () => {
    const seen: string[][] = [];
    await loadThenRefresh(
      { loadItems: async () => ['a'], refreshItems: async () => ['a', 'b'] },
      items => seen.push(items),
    );
    expect(seen).toEqual([['a'], ['a', 'b']]);
  });

  it('keeps what it drew and reports a failed refresh instead of throwing', async () => {
    const seen: string[][] = [];
    const errors: unknown[] = [];
    await loadThenRefresh(
      {
        loadItems: async () => ['a'],
        refreshItems: async () => {
          throw new Error('offline');
        },
      },
      items => seen.push(items),
      error => errors.push(error),
    );
    expect(seen).toEqual([['a']]);
    expect(errors).toHaveLength(1);
  });

  it('lets a failed load through, since there is nothing to show', async () => {
    await expect(
      loadThenRefresh(
        {
          loadItems: async () => {
            throw new Error('vault is locked');
          },
          refreshItems: async () => null,
        },
        () => undefined,
      ),
    ).rejects.toThrow('vault is locked');
  });
});
