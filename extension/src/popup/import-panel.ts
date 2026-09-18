// Importing a CSV export from another password manager or browser.
//
// Parsing happens entirely here, in the popup, before anything is
// encrypted -- the same trust level as typing a new item into the "New
// item" form by hand. Each row then goes through the ordinary `addItem`
// request, one at a time, exactly as if it had been typed in.

import { el } from "./dom.js";
import { parseCsv, rowsToItems, type ImportResult } from "../lib/csvImport.js";
import { parseBitwardenJson } from "../lib/bitwardenImport.js";
import { parseProtonPassJson } from "../lib/protonPassImport.js";
import { send, type ItemContent, type Response } from "../lib/messages.js";

/**
 * Tries each recognised JSON export shape before falling back to CSV.
 *
 * A file that looks like JSON (starts with `{`) but matches neither shape
 * throws "not a Proton Pass export" from the second attempt, which the
 * caller already turns into "Could not read that file." -- no separate
 * error path needed for an unrecognised JSON export.
 */
function detectAndParse(text: string): ImportResult {
  if (text.trim().startsWith("{")) {
    try {
      return parseBitwardenJson(text);
    } catch {
      // Not a Bitwarden export -- fall through to the other JSON shape.
    }
    return parseProtonPassJson(text);
  }
  return rowsToItems(parseCsv(text));
}

function unwrap(response: Response): Response & { ok: true } {
  if (!response.ok) throw new Error(response.error);
  return response;
}

/** What the preview list shows for one parsed row. */
function describe(item: ItemContent): string {
  if (item.name !== undefined) return item.name;
  if (item.type === "login") return item.username !== "" ? item.username : item.url !== "" ? item.url : "(untitled)";
  if (item.type === "card") return item.number !== "" ? `Card ···· ${item.number.slice(-4)}` : "(untitled card)";
  if (item.type === "identity") {
    const fullName = [item.firstName, item.lastName].filter((part) => part !== "").join(" ");
    return fullName !== "" ? fullName : "(untitled identity)";
  }
  return "(untitled note)";
}

interface Parsed {
  item: ItemContent;
  included: boolean;
}

export function importPanel(): HTMLElement {
  const panel = el("div", { className: "group" }, [el("h2", { textContent: "Import" })]);

  let parsed: Parsed[] = [];
  let skipped = 0;
  let result: { imported: number; errors: string[] } | null = null;
  let busy = false;

  const repaint = (): void => {
    panel.replaceChildren(el("h2", { textContent: "Import" }), ...body());
  };

  const pickStage = (): HTMLElement[] => {
    const input = el("input", { type: "file", accept: ".csv,text/csv,.json,application/json" });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      file
        .text()
        .then((text) => {
          const mapped = detectAndParse(text);
          parsed = mapped.items.map((item) => ({ item, included: true }));
          skipped = mapped.skipped;
          result = null;
          repaint();
        })
        .catch(() => {
          panel.append(el("p", { className: "error", textContent: "Could not read that file." }));
        });
    });

    return [
      el("p", {
        className: "muted",
        textContent:
          "Pick a CSV export from Chrome, Firefox, LastPass, 1Password, or similar, a Bitwarden JSON export (logins, secure notes, cards and identities), or a Proton Pass JSON export (logins and secure notes). Anything else in the file is skipped and counted below.",
      }),
      el("label", {}, ["CSV file", input]),
    ];
  };

  const previewStage = (): HTMLElement[] => {
    const rows = parsed.map((row, index) => {
      const checkbox = el("input", { type: "checkbox", checked: row.included });
      checkbox.addEventListener("change", () => {
        parsed[index] = { ...row, included: checkbox.checked };
      });
      return el("li", {}, [
        el("label", {}, [checkbox, ` ${describe(row.item)} · ${row.item.type}`]),
      ]);
    });

    const summary =
      skipped > 0
        ? `${String(parsed.length)} ready to import, ${String(skipped)} skipped (unrecognised type or empty).`
        : `${String(parsed.length)} ready to import.`;

    const submit = el("button", {
      className: "primary",
      type: "button",
      textContent: busy ? "Importing…" : "Import",
      disabled: busy || parsed.every((row) => !row.included),
    });
    submit.addEventListener("click", () => {
      busy = true;
      repaint();
      void (async () => {
        const errors: string[] = [];
        let imported = 0;
        for (const row of parsed) {
          if (!row.included) continue;
          try {
            unwrap(await send({ kind: "addItem", content: row.item }));
            imported += 1;
          } catch (error: unknown) {
            errors.push(`${describe(row.item)}: ${error instanceof Error ? error.message : "failed"}`);
          }
        }
        busy = false;
        result = { imported, errors };
        parsed = [];
        skipped = 0;
        repaint();
      })();
    });

    return [
      el("p", { className: "muted", textContent: summary }),
      el("ul", { className: "devices" }, rows),
      el("div", { className: "field" }, [submit]),
    ];
  };

  const doneStage = (): HTMLElement[] => {
    if (result === null) return [];
    const lines = [
      el("p", {
        textContent:
          result.errors.length > 0
            ? `Imported ${String(result.imported)}. ${String(result.errors.length)} failed.`
            : `Imported ${String(result.imported)}.`,
      }),
      ...result.errors.map((message) => el("p", { className: "error", textContent: message })),
      el("p", {
        className: "muted",
        textContent:
          "Delete the CSV file now that it's imported -- it holds your passwords in plain text.",
      }),
    ];
    const again = el("button", { className: "inline", type: "button", textContent: "Import another file" });
    again.addEventListener("click", () => {
      result = null;
      repaint();
    });
    return [...lines, again];
  };

  function body(): HTMLElement[] {
    if (result !== null) return doneStage();
    if (parsed.length > 0 || skipped > 0) return previewStage();
    return pickStage();
  }

  repaint();
  return panel;
}
