// How the in-page pieces (the picker, the save banner) look.
//
// They are drawn inside pages the extension does not control, so their look is
// fixed rather than inherited: a page's colours, and whether the OS is in dark
// mode, must not decide whether the text is readable or the buttons are
// visible. The surface is always the brand's cream with brown ink, with a hard
// edge, so it reads on a white page and on a black one.
//
// A system font stack, not the extension's bundled fonts. Shipping fonts into
// every page would mean exposing them to every page as web-accessible
// resources, which also lets a page tell that the extension is installed.
//
// Both pieces live in a closed shadow root with every host rule pinned, so
// none of this is reachable from, or restylable by, page script; see
// dropdown.ts for the model.

const SVG_NS = "http://www.w3.org/2000/svg";

export const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
export const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** Shared tokens and the card chrome. Each piece adds its own rules after this. */
export const SKIN = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .card {
    --paper: #FFF8E8; --ink: #674636; --muted: #7E5E4D;
    --line: rgba(103,70,54,.22); --hover: #F3E8CC; --sage: #E6EAD6;
    font: 13px/1.4 ${FONT};
    color: var(--ink); background: var(--paper);
    border: 1px solid var(--line); border-radius: 12px;
    box-shadow: 0 14px 34px -14px rgba(33,25,21,.5), 0 2px 6px rgba(33,25,21,.14);
    overflow: hidden;
    animation: pop .12s ease-out;
  }
  .brand {
    display: flex; align-items: center; gap: 7px;
    font: 700 11px/1 ${FONT}; letter-spacing: .08em; text-transform: uppercase;
  }
  .brand svg { width: 16px; height: 16px; flex: none; }
  /* Position only: starting from opacity 0 would leave the card invisible if the
     page never gets to run the animation, as in a throttled background tab. */
  @keyframes pop { from { transform: translateY(-3px); } to { transform: none; } }
  @media (prefers-reduced-motion: reduce) { .card { animation: none; } }
`;

function svg(doc: Document, size: number, viewBox: string): SVGSVGElement {
  const element = doc.createElementNS(SVG_NS, "svg");
  element.setAttribute("width", String(size));
  element.setAttribute("height", String(size));
  element.setAttribute("viewBox", viewBox);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function shape(doc: Document, tag: string, attributes: Record<string, string>): SVGElement {
  const element = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

/** The dial mark, in the current text colour. Built by hand: no markup is parsed. */
export function brandMark(doc: Document): SVGSVGElement {
  const mark = svg(doc, 16, "0 0 120 120");
  mark.append(
    shape(doc, "circle", { cx: "60", cy: "60", r: "50", fill: "none", stroke: "currentColor", "stroke-width": "13" }),
  );
  for (const angle of [60, 180, 300]) {
    mark.append(
      shape(doc, "rect", {
        x: "55", y: "24", width: "10", height: "20", fill: "currentColor", transform: `rotate(${String(angle)} 60 60)`,
      }),
    );
  }
  mark.append(shape(doc, "circle", { cx: "60", cy: "60", r: "14", fill: "currentColor" }));
  return mark;
}

/** A key, for the suggested-password row. */
export function keyGlyph(doc: Document): SVGSVGElement {
  const glyph = svg(doc, 16, "0 0 24 24");
  const stroke = { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" };
  glyph.append(
    shape(doc, "circle", { cx: "8.5", cy: "15.5", r: "4", ...stroke }),
    shape(doc, "path", { d: "M11.4 12.6L19 5", ...stroke }),
    shape(doc, "path", { d: "M15.5 8.5l2.5 2.5", ...stroke }),
  );
  return glyph;
}

/** One letter to stand in for an item, so a list is quicker to scan than to read. */
export function initialOf(label: string): string {
  const first = [...label.trim()][0];
  return first ? first.toUpperCase() : "•";
}
