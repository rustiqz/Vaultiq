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

import { FONT, MONO, SKIN, brandMark, initialOf, keyGlyph } from "./skin.js";

export interface DropdownEntry {
  id: string;
  label: string;
  detail: string;
  /** Rendered set apart, for the generated-password suggestion. */
  emphasis?: boolean;
}

const HOST_ID = "vaultiq-picker";
const MIN_WIDTH = 280;
const EDGE = 8;

let host: HTMLElement | undefined;
let anchored: HTMLElement | undefined;
let onScroll: ((event: Event) => void) | undefined;
let onResize: (() => void) | undefined;

function style(element: HTMLElement, rules: Record<string, string>): void {
  for (const [property, value] of Object.entries(rules)) {
    element.style.setProperty(property, value, "important");
  }
}

export function closeDropdown(): void {
  const doc = host?.ownerDocument;
  if (onScroll) doc?.removeEventListener("scroll", onScroll, true);
  if (onResize) doc?.defaultView?.removeEventListener("resize", onResize);

  host?.remove();
  host = undefined;
  anchored = undefined;
  onScroll = undefined;
  onResize = undefined;
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
  const width = Math.max(box.width, MIN_WIDTH);
  // Kept on screen: a field near the right edge would otherwise push the
  // picker half out of the viewport, where its buttons cannot be reached.
  const room = doc.documentElement.clientWidth - width - EDGE;
  const left = Math.max(EDGE, Math.min(box.left, room));

  host = doc.createElement("div");
  host.id = HOST_ID;
  style(host, {
    position: "absolute",
    left: `${String(left + doc.defaultView!.scrollX)}px`,
    top: `${String(box.bottom + doc.defaultView!.scrollY + 2)}px`,
    width: `${String(width)}px`,
    "z-index": "2147483647",
    // Light always: the card has its own fixed palette, and a forced dark
    // scheme would restyle its form-like parts out from under it.
    "color-scheme": "light",
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
  sheet.textContent = `${SKIN}
    .head { display: flex; align-items: center; padding: 10px 12px 6px; }
    .count { margin-left: auto; font: 500 11px/1 ${FONT}; letter-spacing: 0; text-transform: none; color: var(--muted); }
    ul {
      margin: 0; padding: 2px 6px 6px; list-style: none;
      max-height: 252px; overflow-y: auto; scrollbar-width: thin;
    }
    button {
      all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px; border-radius: 9px; cursor: pointer; color: var(--ink);
    }
    button:hover, button:focus-visible { background: var(--hover); }
    button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
    .avatar {
      flex: none; width: 30px; height: 30px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      background: #fff; border: 1px solid var(--line); font: 700 13px/1 ${FONT};
    }
    .text { min-width: 0; flex: 1; }
    .label { font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .detail { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .fill {
      flex: none; padding: 3px 7px; border-radius: 6px; opacity: 0;
      background: var(--ink); color: var(--paper); font: 700 11px/1.2 ${FONT}; letter-spacing: .04em;
    }
    button:hover .fill, button:focus-visible .fill { opacity: 1; }
    li.emphasis { margin: 2px 0 6px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
    li.emphasis button { background: var(--sage); }
    li.emphasis button:hover, li.emphasis button:focus-visible { background: #DADFC4; }
    li.emphasis .avatar { background: var(--ink); color: var(--paper); border-color: var(--ink); }
    li.emphasis .detail {
      font-family: ${MONO}; color: var(--ink); white-space: normal; overflow-wrap: anywhere;
    }
  `;

  const card = doc.createElement("div");
  card.className = "card";

  const head = doc.createElement("div");
  head.className = "brand head";
  const wordmark = doc.createElement("span");
  wordmark.textContent = "Vaultiq";
  head.append(brandMark(doc), wordmark);
  const saved = entries.filter((entry) => !entry.emphasis).length;
  if (saved > 0) {
    const count = doc.createElement("span");
    count.className = "count";
    count.textContent = `${String(saved)} saved`;
    head.append(count);
  }

  const list = doc.createElement("ul");
  for (const entry of entries) {
    const button = doc.createElement("button");
    button.type = "button";

    const avatar = doc.createElement("span");
    avatar.className = "avatar";
    if (entry.emphasis) avatar.append(keyGlyph(doc));
    else avatar.textContent = initialOf(entry.label);

    const label = doc.createElement("div");
    label.className = "label";
    label.textContent = entry.label;

    const detail = doc.createElement("div");
    detail.className = "detail";
    detail.textContent = entry.detail;

    const text = doc.createElement("div");
    text.className = "text";
    text.append(label, detail);

    const fill = doc.createElement("span");
    fill.className = "fill";
    fill.textContent = entry.emphasis ? "Use" : "Fill";

    button.append(avatar, text, fill);
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

  card.append(head, list);
  shadow.append(sheet, card);
  doc.body.append(host);

  anchored = anchor;

  // Only an *inner* scroll dismisses. The picker is positioned in page
  // coordinates, so scrolling the window carries it along with the field it
  // belongs to — closing there would kill it the instant a browser scrolled
  // the focused field into view, which is exactly what it did.
  onScroll = (event: Event) => {
    if (event.target !== doc && event.target !== doc.defaultView) closeDropdown();
  };
  onResize = () => {
    closeDropdown();
  };

  doc.addEventListener("scroll", onScroll, true);
  doc.defaultView?.addEventListener("resize", onResize);
}

/** Whether a click landed inside the picker. */
export function isInsideDropdown(target: EventTarget | null): boolean {
  return host !== undefined && target instanceof Node && host.contains(target);
}

/**
 * Whether a click should leave the picker open.
 *
 * True inside the picker, and true on the field it belongs to — clicking that
 * field is what opened it, and treating that click as "elsewhere" closed it
 * again the same instant.
 */
export function belongsToDropdown(target: EventTarget | null): boolean {
  if (isInsideDropdown(target)) return true;
  return anchored !== undefined && target instanceof Node && anchored.contains(target);
}
