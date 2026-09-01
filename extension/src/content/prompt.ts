// The "save this login?" banner.
//
// Same hostile-document rules as the picker: a closed shadow root so page
// script cannot read or click it, and every layout rule pinned so page CSS
// cannot hide it while leaving it clickable.
//
// It shows the username and the site. It never shows the password — there is
// no reason to put a secret on screen to ask a yes/no question, and a banner
// that displayed one would be worth phishing.

const HOST_ID = "vaultiq-save-prompt";

let host: HTMLElement | undefined;

function style(element: HTMLElement, rules: Record<string, string>): void {
  for (const [property, value] of Object.entries(rules)) {
    element.style.setProperty(property, value, "important");
  }
}

export function closePrompt(): void {
  host?.remove();
  host = undefined;
}

export interface PromptCopy {
  title: string;
  detail: string;
  confirm: string;
}

/** What the user chose to call the login, before it is stored. */
export interface PromptAnswer {
  name: string;
  notes: string;
}

/**
 * What a click on the banner means.
 *
 * Extracted so it can be tested: a trusted event cannot be synthesised, in a
 * page or in a test, so the click path itself is only exercisable for the
 * *untrusted* case. This is the part with the decision in it.
 *
 * Dismissing yields `undefined` rather than an empty answer, so "not now" can
 * never be mistaken for "save without a name".
 */
export function answerFrom(saving: boolean, name: string, notes: string): PromptAnswer | undefined {
  return saving ? { name: name.trim(), notes: notes.trim() } : undefined;
}

const SHEET = `
  :host { all: initial; }
  .card {
    font: 13px/1.45 system-ui, sans-serif;
    background: Canvas; color: CanvasText;
    border: 1px solid rgba(128,128,128,.45); border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,.25);
    padding: 12px 13px;
  }
  .brand {
    font-size: 10px; letter-spacing: .09em; text-transform: uppercase;
    opacity: .55; margin-bottom: 6px;
  }
  .title { font-weight: 600; }
  .detail { opacity: .75; font-size: 12px; margin-top: 2px; overflow-wrap: anywhere; }
  /* Small, because there is little to say — but scrollable, so a cramped
     viewport never clips the buttons. */
  .fields { max-height: 168px; overflow-y: auto; margin-top: 10px; }
  label { display: block; font-size: 11px; opacity: .75; margin-top: 7px; }
  input, textarea {
    display: block; width: 100%; box-sizing: border-box; margin-top: 3px;
    font: inherit; font-size: 12px; padding: 5px 7px; border-radius: 4px;
    border: 1px solid rgba(128,128,128,.45);
    background: Field; color: FieldText;
  }
  textarea { resize: vertical; min-height: 40px; }
  .row { display: flex; gap: 8px; margin-top: 11px; }
  button {
    all: unset; flex: 1; text-align: center; box-sizing: border-box;
    padding: 7px 9px; border-radius: 5px; cursor: pointer;
    font: inherit; font-weight: 600;
    border: 1px solid rgba(128,128,128,.45);
  }
  button.primary { background: Highlight; color: HighlightText; border-color: transparent; }
  button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
`;

/**
 * Builds the card, separately from mounting it.
 *
 * Split out so the behaviour can be exercised directly. Once mounted the card
 * lives in a *closed* shadow root that page script cannot reach into — and
 * neither can a test. Keeping construction addressable here means the
 * behaviour stays testable without weakening what makes it safe.
 *
 * A login named at the moment it is created is far more likely to carry a
 * useful name than one named later, so the fields are here rather than in a
 * follow-up trip to the popup. Both are optional.
 */
export function buildPromptCard(
  doc: Document,
  copy: PromptCopy,
  decide: (answer: PromptAnswer | undefined) => void,
): HTMLElement {
  const card = doc.createElement("div");
  card.className = "card";

  const brand = doc.createElement("div");
  brand.className = "brand";
  brand.textContent = "Vaultiq";

  const title = doc.createElement("div");
  title.className = "title";
  title.textContent = copy.title;

  const detail = doc.createElement("div");
  detail.className = "detail";
  detail.textContent = copy.detail;

  const fields = doc.createElement("div");
  fields.className = "fields";

  const nameLabel = doc.createElement("label");
  nameLabel.textContent = "Name (optional)";
  const name = doc.createElement("input");
  name.type = "text";
  name.placeholder = "e.g. Work";
  name.className = "name";
  nameLabel.append(name);

  const notesLabel = doc.createElement("label");
  notesLabel.textContent = "Notes (optional)";
  const notes = doc.createElement("textarea");
  notes.className = "notes";
  notesLabel.append(notes);

  fields.append(nameLabel, notesLabel);

  const save = doc.createElement("button");
  save.type = "button";
  save.className = "primary save";
  save.textContent = copy.confirm;

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.className = "dismiss";
  dismiss.textContent = "Not now";

  for (const [button, saving] of [
    [save, true],
    [dismiss, false],
  ] as const) {
    button.addEventListener("click", (event) => {
      // Rejects a click synthesised by page script. It cannot reach into a
      // closed root to dispatch one, but this removes the question.
      if (!event.isTrusted) return;
      const answer = answerFrom(saving, name.value, notes.value);
      closePrompt();
      decide(answer);
    });
  }

  const row = doc.createElement("div");
  row.className = "row";
  row.append(save, dismiss);

  card.append(brand, title, detail, fields, row);
  return card;
}

/** Shows the banner, anchored to the top right of the page. */
export function showPrompt(
  doc: Document,
  copy: PromptCopy,
  decide: (answer: PromptAnswer | undefined) => void,
): void {
  closePrompt();

  host = doc.createElement("div");
  host.id = HOST_ID;
  style(host, {
    position: "fixed",
    top: "16px",
    right: "16px",
    width: "320px",
    "z-index": "2147483647",
    "color-scheme": "light dark",
    margin: "0",
    padding: "0",
    border: "0",
    display: "block",
    opacity: "1",
    visibility: "visible",
    transform: "none",
    filter: "none",
    "pointer-events": "auto",
  });

  const shadow = host.attachShadow({ mode: "closed" });

  const sheet = doc.createElement("style");
  sheet.textContent = SHEET;

  shadow.append(sheet, buildPromptCard(doc, copy, decide));
  doc.body.append(host);
}

/** Whether the prompt is currently on screen. */
export function isPromptOpen(): boolean {
  return host !== undefined;
}
