// The small Vaultiq mark inside a fillable field, which opens the picker.
//
// The picker opens on its own the first time a field is focused and then
// stays out of the way: once it has been closed on a field it is not reopened
// by focusing that field again (a fill ends in `focus()`, which would
// otherwise bring it straight back). This mark is how the user asks for it
// again, and it is drawn only while the field is focused or hovered, so
// nothing is shown, and nothing is asked of the vault, on a page nobody has
// touched.
//
// It is drawn the way the picker is (see dropdown.ts): a closed shadow root,
// every host rule pinned inline with `!important`, and a click that counts only
// if it is trusted. It carries no data and fills nothing; a click only asks
// the content script to open the picker, whose entries still need their own
// click.

import { SKIN, brandMark } from "./skin.js";

const HOST_ID = "vaultiq-launcher";
const SIZE = 22;
const INSET = 6;

let host: HTMLElement | undefined;
let anchored: HTMLInputElement | undefined;
let onScroll: (() => void) | undefined;
let onResize: (() => void) | undefined;

/**
 * Fields whose picker the user has closed. Weak, so a removed field does not
 * keep an entry alive; reset by a page load, which is the intended lifetime.
 */
const dismissed = new WeakSet<HTMLElement>();

export function markDismissed(field: HTMLElement): void {
  dismissed.add(field);
}

export function isDismissed(field: HTMLElement): boolean {
  return dismissed.has(field);
}

function style(element: HTMLElement, rules: Record<string, string>): void {
  for (const [property, value] of Object.entries(rules)) {
    element.style.setProperty(property, value, "important");
  }
}

export function hideLauncher(): void {
  const doc = host?.ownerDocument;
  if (onScroll) doc?.removeEventListener("scroll", onScroll, true);
  if (onResize) doc?.defaultView?.removeEventListener("resize", onResize);

  host?.remove();
  host = undefined;
  anchored = undefined;
  onScroll = undefined;
  onResize = undefined;
}

/** The field the mark is currently attached to. */
export function launcherAnchor(): HTMLInputElement | undefined {
  return anchored;
}

/** Whether an event target is the mark itself. */
export function isInsideLauncher(target: EventTarget | null): boolean {
  return host !== undefined && target instanceof Node && host.contains(target);
}

/**
 * Puts the mark at the right edge of `anchor`.
 *
 * If something of the page's own (a "show password" eye, say) is already
 * there, the mark steps left of it instead of covering it.
 */
function place(anchor: HTMLInputElement, element: HTMLElement): boolean {
  const doc = anchor.ownerDocument;
  const view = doc.defaultView;
  if (!view) return false;
  const box = anchor.getBoundingClientRect();
  if (box.width < SIZE * 3 || box.height < SIZE - 4) return false;

  const top = box.top + (box.height - SIZE) / 2;
  let left = box.right - INSET - SIZE;

  // Not available everywhere (jsdom has none); without it the mark simply
  // takes the default spot.
  if (typeof doc.elementFromPoint === "function") {
    for (let step = 0; step < 3; step += 1) {
      const covered = doc.elementFromPoint(left + SIZE / 2, top + SIZE / 2);
      if (covered === null || covered === anchor || covered === element) break;
      left -= SIZE + 4;
    }
  }
  if (left < box.left) return false;

  style(element, {
    left: `${String(left + view.scrollX)}px`,
    top: `${String(top + view.scrollY)}px`,
  });
  return true;
}

/**
 * Shows the mark on `anchor`. `open` is called on a genuine click.
 */
export function showLauncher(anchor: HTMLInputElement, open: () => void): void {
  if (host && anchored === anchor) {
    // Already there: just keep it where the field is.
    place(anchor, host);
    return;
  }
  hideLauncher();

  const doc = anchor.ownerDocument;
  const element = doc.createElement("div");
  element.id = HOST_ID;
  style(element, {
    position: "absolute",
    width: `${String(SIZE)}px`,
    height: `${String(SIZE)}px`,
    "z-index": "2147483646",
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
  if (!place(anchor, element)) return;

  const shadow = element.attachShadow({ mode: "closed" });
  const sheet = doc.createElement("style");
  sheet.textContent = `${SKIN}
    button {
      all: unset; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
      width: ${String(SIZE)}px; height: ${String(SIZE)}px; border-radius: 6px; cursor: pointer;
      color: #674636; background: #FFF8E8; border: 1px solid rgba(103,70,54,.35);
    }
    button:hover, button:focus-visible { background: #F3E8CC; }
    button:focus-visible { outline: 2px solid #674636; outline-offset: 1px; }
    svg { width: 14px; height: 14px; }
  `;

  const button = doc.createElement("button");
  button.type = "button";
  button.title = "Fill with Vaultiq";
  button.setAttribute("aria-label", "Fill with Vaultiq");
  button.append(brandMark(doc));
  // Pressing the mark must not take focus from the field: a blur would hide
  // the mark before the click lands, and a refocus afterwards is not wanted.
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    open();
  });

  shadow.append(sheet, button);
  doc.body.append(element);
  host = element;
  anchored = anchor;

  const reposition = (): void => {
    if (!anchored || !anchored.isConnected || !host || !place(anchored, host)) hideLauncher();
  };
  onScroll = reposition;
  onResize = reposition;
  doc.addEventListener("scroll", onScroll, true);
  doc.defaultView?.addEventListener("resize", onResize);
}
