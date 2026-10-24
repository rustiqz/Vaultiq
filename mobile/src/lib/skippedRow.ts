/**
 * A row an importer could not turn into an item, kept so the user can see why
 * and fix it rather than only being told how many were dropped.
 */
export interface SkippedRow {
  /** What to call it in the list. */
  label: string;
  /** Why it was skipped, in plain words. */
  reason: string;
  /** Whatever could be read from the row, to start a fix from. */
  draft: SkippedDraft;
}

export interface SkippedDraft {
  name: string;
  username: string;
  password: string;
  url: string;
  notes: string;
}

export function skippedLabel(draft: SkippedDraft, index: number): string {
  return draft.name !== '' ? draft.name : draft.username !== '' ? draft.username : `Row ${String(index + 1)}`;
}
