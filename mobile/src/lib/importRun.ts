import type { ItemContent } from '../itemContent';
import { displayName } from '../itemContent';
import type { DedupeMatch } from './importDedupe';

/** One row of the preview: what to import, and what it was matched against. */
export type ImportRow = { item: ItemContent; included: boolean; match: DedupeMatch | null; replace: boolean };

/** What the import did, row by row. */
export type ImportOutcome = {
  added: number;
  replaced: number;
  failures: { name: string; message: string }[];
};

export type ImportProgress = {
  /** Rows finished, whether they worked or not. */
  done: number;
  /** Rows that were ticked: the only ones that count. */
  total: number;
  /** The row being worked on, or the one just finished. */
  current: string;
};

/** The two writes an import makes, taken as parameters so this does not need a vault. */
export type ImportOperations = {
  add: (item: ItemContent) => Promise<unknown>;
  update: (id: string, version: number, item: ItemContent) => Promise<unknown>;
};

/**
 * Writes every ticked row, one at a time, and reports how far it has got.
 *
 * Each row goes through the same `add` or `update` a hand-typed item does.
 * One that fails is recorded and the rest still run: half an import that
 * says exactly what it missed is better than one that stops at the first
 * problem and leaves the person to work out where.
 */
export async function runImport(
  rows: ImportRow[],
  operations: ImportOperations,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportOutcome> {
  const chosen = rows.filter(row => row.included);
  const outcome: ImportOutcome = { added: 0, replaced: 0, failures: [] };

  let done = 0;
  for (const row of chosen) {
    const name = displayName(row.item.type, row.item, String(done + 1));
    onProgress?.({ done, total: chosen.length, current: name });
    try {
      if (row.match !== null && row.replace) {
        await operations.update(row.match.id, row.match.version, row.item);
        outcome.replaced += 1;
      } else {
        await operations.add(row.item);
        outcome.added += 1;
      }
    } catch (thrown) {
      outcome.failures.push({ name, message: thrown instanceof Error ? thrown.message : String(thrown) });
    }
    done += 1;
    onProgress?.({ done, total: chosen.length, current: name });
  }
  return outcome;
}
