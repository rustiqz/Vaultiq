// Generates the toolbar and manifest icons from the production mark's geometry
// (site/assets/logo/mark-micro.svg for 16px, mark-compact.svg above that).
//
// Run by hand: `pnpm run icons`. The PNGs it writes are committed, like the
// launcher icons on mobile, so a normal build needs no SVG renderer.
//
// What it writes into public/icons/:
//   {16,32,48,128}.png                  the mark on a transparent ground, no dot
//                                       (manifest `icons`: extensions page, store)
//   state-{none,locked,unlocked}-N.png  the same with a status dot, for the
//                                       toolbar button (`action.setIcon`)
//
// The ground is transparent so the mark sits on the toolbar as it is. A dark
// brown mark vanishes on a dark toolbar, so each shape is drawn twice: a thin
// cream outline underneath, the brown mark on top. Colour alone is not enough
// for the dot either (about one man in twelve cannot tell red from green), so
// the larger sizes carry a shape inside it: a padlock when locked, a tick when
// unlocked, nothing when there is no vault yet.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const INK = "#674636";
const CREAM = "#FFF8E8";
const DOT = { none: "#8C8680", locked: "#A63D22", unlocked: "#3F7D3A" };
const SIZES = [16, 32, 48, 128];

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const rotated = (angle: number): string => `transform="rotate(${angle} 60 60)"`;

/** The dial. `grow` widens every shape, which makes the outline underlay. */
function dial(size: number, color: string, grow: number): string {
  const parts: string[] = [];
  if (size <= 16) {
    // mark-micro: one heavy ring, no inner ring.
    parts.push(`<circle cx="60" cy="60" r="50" fill="none" stroke="${color}" stroke-width="${13 + 2 * grow}"/>`);
    for (const angle of [60, 180, 300]) {
      parts.push(`<rect x="${55 - grow}" y="${24 - grow}" width="${10 + 2 * grow}" height="${20 + 2 * grow}" fill="${color}" ${rotated(angle)}/>`);
    }
    parts.push(`<circle cx="60" cy="60" r="${14 + grow}" fill="${color}"/>`);
  } else {
    // mark-compact.
    parts.push(`<circle cx="60" cy="60" r="51" fill="none" stroke="${color}" stroke-width="${10 + 2 * grow}"/>`);
    parts.push(`<circle cx="60" cy="60" r="31" fill="none" stroke="${color}" stroke-width="${4 + 2 * grow}"/>`);
    for (const angle of [60, 180, 300]) {
      parts.push(`<rect x="${56 - grow}" y="${20 - grow}" width="${8 + 2 * grow}" height="${22 + 2 * grow}" fill="${color}" ${rotated(angle)}/>`);
    }
    parts.push(`<circle cx="60" cy="60" r="${13 + grow}" fill="${color}"/>`);
  }
  return parts.join("");
}

/** The status dot, bottom right, with a cream ring so it separates from the dial. */
type State = keyof typeof DOT;

function dot(size: number, state: State): string {
  const small = size <= 16;
  const cx = small ? 88 : 91;
  const r = small ? 31 : 27;
  const parts = [
    `<circle cx="${cx}" cy="${cx}" r="${r + 5}" fill="${CREAM}"/>`,
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="${DOT[state]}"/>`,
  ];
  if (small || state === "none") return parts.join("");

  if (state === "unlocked") {
    parts.push(
      `<path d="M${cx - 10} ${cx + 1} l7 7 l13 -14" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
  } else {
    parts.push(
      `<rect x="${cx - 9}" y="${cx - 1}" width="18" height="13" rx="2.5" fill="#fff"/>`,
      `<path d="M${cx - 5.5} ${cx - 1} v-4.5 a5.5 5.5 0 0 1 11 0 v4.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>`,
    );
  }
  return parts.join("");
}

function svg(size: number, state: State | undefined): string {
  const outline = size <= 16 ? 3.5 : 2.5;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120">`,
    dial(size, CREAM, outline),
    dial(size, INK, 0),
    state === undefined ? "" : dot(size, state),
    "</svg>",
  ].join("");
}

const scratch = mkdtempSync(join(tmpdir(), "vaultiq-icons-"));
try {
  const render = (name: string, size: number, state: State | undefined): void => {
    const source = join(scratch, `${name}.svg`);
    writeFileSync(source, svg(size, state));
    execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), "-f", "png", "-o", join(out, `${name}.png`), source]);
  };
  for (const size of SIZES) {
    render(String(size), size, undefined);
    for (const state of Object.keys(DOT) as State[]) render(`state-${state}-${String(size)}`, size, state);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`wrote ${String(SIZES.length * (1 + Object.keys(DOT).length))} icons to ${out}`);
