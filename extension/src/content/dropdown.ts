// The in-page credential picker.
//
// This renders inside a document the extension does not control, so the page
// is treated as hostile throughout:
//
//   * A **closed** shadow root. `mode: "closed"` means page script cannot
//     reach into it via `element.shadowRoot`, so it cannot read what is
//     listed or synthesise a click on an entry.
//   * Every style is set on the host element inline with `!important`, so
//     page CSS cannot move the dropdown off-screen, shrink it to nothing, or
//     make it transparent while leaving it clickable.
//   * No password is ever rendered or held here. The list shows names and
//     usernames; the password is requested from the background only after a
//     real click, and goes straight into the field.
//
// What this cannot defend against is a page drawing a *convincing copy* of
// this dropdown to phish a click. Nothing rendered in-page can. The mitigation
// is that picking an entry fills a field rather than revealing anything, so a
// fake dropdown gains the page nothing it could not already have shown.

export interface DropdownEntry {
  id: string;
  label: string;
  detail: string;
  /** Rendered set apart, for the generated-password suggestion. */
  emphasis?: boolean;
}

const HOST_ID = "vaultiq-picker";

let host: HTMLElement | undefined;
let onDismiss: (() => void) | undefined;

function style(element: HTMLElement, rules: Record<string, string>): void {
  for (const [property, value] of Object.entries(rules)) {
    element.style.setProperty(property, value, "important");
  }
}

export function closeDropdown(): void {
  host?.remove();
  host = undefined;
  onDismiss = undefined;
}

/**
 * Shows the picker anchored under `anchor`.
 *
 * `choose` is called with the chosen entry's id. It is only ever reached by a
 * genuine click inside the closed shadow root.
 */
export function showDropdown(
  anchor: HTMLElement,
  entries: DropdownEntry[],
  choose: (id: string) => void,
): void {
  closeDropdown();
  if (entries.length === 0) return;

  const doc = anchor.ownerDocument;
  const box = anchor.getBoundingClientRect();

  host = doc.createElement("div");
  host.id = HOST_ID;
  style(host, {
    position: "absolute",
    left: `${String(box.left + doc.defaultView!.scrollX)}px`,
    top: `${String(box.bottom + doc.defaultView!.scrollY + 2)}px`,
    width: `${String(Math.max(box.width, 220))}px`,
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

  // Closed: page script cannot reach in through element.shadowRoot.
  const shadow = host.attachShadow({ mode: "closed" });

  const sheet = doc.createElement("style");
  sheet.textContent = `
    :host { all: initial; }
    ul {
      margin: 0; padding: 4px; list-style: none;
      font: 13px/1.4 system-ui, sans-serif;
      background: Canvas; color: CanvasText;
      border: 1px solid rgba(128,128,128,.45); border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0,0,0,.22);
      max-height: 240px; overflow-y: auto;
    }
    li { border-radius: 4px; }
    button {
      all: unset; display: block; width: 100%; box-sizing: border-box;
      padding: 7px 9px; cursor: pointer; font: inherit; color: inherit;
    }
    button:hover, button:focus-visible { background: rgba(128,128,128,.18); }
    button:focus-visible { outline: 2px solid Highlight; outline-offset: -2px; }
    .label { font-weight: 600; }
    .detail { opacity: .7; font-size: 12px; }
    li.emphasis { border-bottom: 1px solid rgba(128,128,128,.3); margin-bottom: 2px; }
    li.emphasis .detail {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      opacity: .95; overflow-wrap: anywhere;
    }
    .brand {
      padding: 4px 9px 6px; font: 10px/1 system-ui, sans-serif;
      letter-spacing: .09em; text-transform: uppercase; opacity: .55;
    }
  `;

  const list = doc.createElement("ul");
  for (const entry of entries) {
    const button = doc.createElement("button");
    button.type = "button";

    const label = doc.createElement("div");
    label.className = "label";
    label.textContent = entry.label;

    const detail = doc.createElement("div");
    detail.className = "detail";
    detail.textContent = entry.detail;

    button.append(label, detail);
    // `isTrusted` rejects a click synthesised by page script. It cannot reach
    // into a closed root to dispatch one, but this costs nothing and removes
    // the question.
    button.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      const chosen = entry.id;
      closeDropdown();
      choose(chosen);
    });

    const item = doc.createElement("li");
    if (entry.emphasis) item.className = "emphasis";
    item.append(button);
    list.append(item);
  }

  const brand = doc.createElement("div");
  brand.className = "brand";
  brand.textContent = "Vaultiq";

  shadow.append(sheet, list, brand);
  doc.body.append(host);

  onDismiss = () => {
    closeDropdown();
  };
  doc.addEventListener("scroll", onDismiss, { capture: true, once: true });
  doc.defaultView?.addEventListener("resize", onDismiss, { once: true });
}

/** Whether a click landed inside the picker. */
export function isInsideDropdown(target: EventTarget | null): boolean {
  return host !== undefined && target instanceof Node && host.contains(target);
}
