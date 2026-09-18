// Parses Proton Pass's unencrypted JSON vault export into ItemContent rows.
//
// Confirmed against a real exported file (via an independently-built
// Proton-Pass-to-CSV converter) and a forum thread quoting real exported
// JSON, not guessed: `{ vaults: { <vaultId>: { items: [{ state, data:
// { type, metadata: {name, note}, content: {username, password, urls,
// totpUri} } }] } } }`. Only `type: "login"` and `type: "note"` are
// recognised -- Proton's alias/creditCard/identity content field names were
// not confirmed against a real sample (their JSON export schema is
// undocumented, and the open-source `proton-pass-common` repo stores items
// as protobuf internally, a different, unrelated schema from the exported
// DTO), so per this project's don't-guess-at-an-unclear-field rule they are
// skipped and counted rather than mapped from the Rust-side type names
// alone. Trashed items (`state: 2`) are skipped too -- importing something
// the user deleted back to life isn't "the same content typed by hand,"
// which is the bar every import in this project holds to.

import type { ItemContent, LoginContent, NoteContent } from "./messages.js";
import type { ImportResult } from "./csvImport.js";

/** `ItemState::Trashed` in proton-pass-common's Rust source. */
const TRASHED = 2;

interface ProtonPassItem {
  state?: number;
  data?: {
    type?: string;
    metadata?: { name?: string | null; note?: string | null };
    content?: {
      username?: string | null;
      password?: string | null;
      urls?: (string | null)[] | null;
    };
  };
}

interface ProtonPassVault {
  items?: ProtonPassItem[];
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * Parses a Proton Pass unencrypted JSON export into `ItemContent`s.
 *
 * Throws if `raw` isn't valid JSON or has no `vaults` object at all -- the
 * caller treats that as "not a Proton Pass export."
 */
export function parseProtonPassJson(raw: string): ImportResult {
  const data = JSON.parse(raw) as { vaults?: Record<string, ProtonPassVault> };
  if (typeof data.vaults !== "object" || data.vaults === null) throw new Error("not a Proton Pass export");

  const items: ItemContent[] = [];
  let skipped = 0;

  for (const vault of Object.values(data.vaults)) {
    for (const entry of vault.items ?? []) {
      if (entry.state === TRASHED) {
        skipped += 1;
        continue;
      }

      const metadata = entry.data?.metadata ?? {};
      const notes = text(metadata.note);
      const name = text(metadata.name);
      const named = name === "" ? {} : { name };

      if (entry.data?.type === "note") {
        if (notes === "" && name === "") {
          skipped += 1;
          continue;
        }
        const item: NoteContent = { type: "note", notes, ...named };
        items.push(item);
        continue;
      }

      if (entry.data?.type === "login") {
        const content = entry.data.content ?? {};
        const username = text(content.username);
        const password = text(content.password);
        if (username === "" && password === "") {
          skipped += 1;
          continue;
        }
        const url = text(content.urls?.find((candidate) => text(candidate) !== ""));
        const item: LoginContent = { type: "login", username, password, url, notes, ...named };
        items.push(item);
        continue;
      }

      // alias/creditCard/identity/sshKey/wifi/custom: field names not
      // confirmed against a real export for this version -- see the note
      // at the top of this file.
      skipped += 1;
    }
  }

  return { items, skipped };
}
