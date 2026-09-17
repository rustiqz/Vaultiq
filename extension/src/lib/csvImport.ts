// Parses a CSV export from another password manager or browser into
// ItemContent rows, ready to hand to `addItem` one at a time (see
// `popup/index.ts`'s `importPanel()`). Runs entirely in the popup, before
// anything is encrypted -- the same trust level as typing a new item into
// the "New item" form by hand. No CSV library: a hand-rolled parser for one
// well-understood grammar is simpler and more auditable than a dependency
// for it, the same call this repo already made for `otpauth.ts` and
// `lib/id.ts`'s UUID helper.
//
// v1 recognises login and note rows only -- see CLAUDE.md §1.3 for why
// cards/identities/TOTP are deliberately not guessed at from a CSV column.

import type { ItemContent, LoginContent, NoteContent } from "./messages.js";

/** Splits CSV text into rows of raw string cells (RFC4180-ish: quoted fields, embedded commas/newlines, `""` as an escaped quote, CRLF or LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ",") {
      endField();
      i += 1;
    } else if (char === "\r") {
      i += 1;
    } else if (char === "\n") {
      endRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  // A file with no trailing newline still has one last row to flush.
  if (field !== "" || row.length > 0) endRow();

  // A blank line parses as a single empty cell; it is not a data row.
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}

type Field = "name" | "url" | "username" | "password" | "notes" | "type";

/** Column names this recognises, by field, lowercase, checked in order. */
const ALIASES: Record<Field, string[]> = {
  name: ["name", "title"],
  url: ["url", "login_uri", "uri", "website"],
  username: ["username", "login_username"],
  password: ["password", "login_password"],
  notes: ["notes", "extra", "note"],
  type: ["type"],
};

/** Maps each recognised field to the column index that carries it, if any. */
function buildColumnIndex(header: string[]): Partial<Record<Field, number>> {
  const normalized = header.map((value) => value.trim().toLowerCase());
  const index: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const found = normalized.indexOf(alias);
      if (found !== -1) {
        index[field] = found;
        break;
      }
    }
  }
  return index;
}

function cell(row: string[], index: Partial<Record<Field, number>>, field: Field): string {
  const position = index[field];
  return position === undefined ? "" : (row[position] ?? "").trim();
}

export interface ImportResult {
  items: ItemContent[];
  /** Rows that were neither a login nor a note, or had nothing meaningful in them. */
  skipped: number;
}

/** Turns parsed CSV rows (header first) into `ItemContent`s ready for `addItem`. */
export function rowsToItems(rows: string[][]): ImportResult {
  const header = rows[0];
  if (header === undefined) return { items: [], skipped: 0 };
  const dataRows = rows.slice(1);
  const index = buildColumnIndex(header);

  const items: ItemContent[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    const kind = cell(row, index, "type").toLowerCase();
    const notes = cell(row, index, "notes");
    const name = cell(row, index, "name");

    if (kind === "note" || kind === "secure note") {
      if (notes === "" && name === "") {
        skipped += 1;
        continue;
      }
      const item: NoteContent = { type: "note", notes, ...(name === "" ? {} : { name }) };
      items.push(item);
      continue;
    }

    // Absent or "login" is the default -- most exports (Chrome's included)
    // have no type column at all and are entirely logins. Anything else is
    // a type this version deliberately does not try to guess a mapping for.
    if (kind !== "" && kind !== "login") {
      skipped += 1;
      continue;
    }

    const username = cell(row, index, "username");
    const password = cell(row, index, "password");
    if (username === "" && password === "") {
      skipped += 1;
      continue;
    }

    const item: LoginContent = {
      type: "login",
      username,
      password,
      url: cell(row, index, "url"),
      notes,
      ...(name === "" ? {} : { name }),
    };
    items.push(item);
  }

  return { items, skipped };
}
