import type { EncryptedItem } from '../nativeCryptoCore';

/**
 * Folds incoming ciphertext into the cached set by id. The higher version
 * wins; on a tie the incoming one does, since a retried push can land the same
 * version twice. Versions only move forward, so an older arrival (a pull that
 * started before a local push finished) must never replace what is cached.
 */
export function mergeEncrypted(existing: EncryptedItem[], incoming: EncryptedItem[]): EncryptedItem[] {
  const byId = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (current === undefined || item.version >= current.version) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/**
 * Serialises read-modify-write sequences on one resource. The sync cache is
 * written by a pull, by a push and by the foreground sync; without this, two
 * of them interleaving can drop each other's update.
 */
export function createLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return fn => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Shows what is already on the device first, then updates only if the server had news. */
export async function loadThenRefresh<T>(
  source: { loadItems(): Promise<T[]>; refreshItems(): Promise<T[] | null> },
  onItems: (items: T[]) => void,
  onRefreshError?: (error: unknown) => void,
): Promise<void> {
  onItems(await source.loadItems());
  try {
    const fresh = await source.refreshItems();
    if (fresh !== null) onItems(fresh);
  } catch (error) {
    onRefreshError?.(error);
  }
}
