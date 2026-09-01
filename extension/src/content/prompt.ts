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

/** Asks the user a yes/no question, anchored to the top right of the page. */
export function showPrompt(doc: Document, copy: PromptCopy, decide: (save: boolean) => void): void {
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
  sheet.textContent = `
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

  const save = doc.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = copy.confirm;

  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Not now";

  for (const [button, answer] of [
    [save, true],
    [dismiss, false],
  ] as const) {
    button.addEventListener("click", (event) => {
      // Rejects a click synthesised by page script. It cannot reach into a
      // closed root to dispatch one, but this removes the question.
      if (!event.isTrusted) return;
      closePrompt();
      decide(answer);
    });
  }

  const row = doc.createElement("div");
  row.className = "row";
  row.append(save, dismiss);

  card.append(brand, title, detail, row);
  shadow.append(sheet, card);
  doc.body.append(host);
}

/** Whether the prompt is currently on screen. */
export function isPromptOpen(): boolean {
  return host !== undefined;
}
