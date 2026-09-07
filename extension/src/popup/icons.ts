// The redesign's hand-drawn icon set and dial logo mark, ported from
// mobile/src/icons.tsx and mobile/src/LogoMark.tsx -- one source of shapes,
// two renderers (react-native-svg there, raw DOM here, since the extension
// has no UI framework). Keep the path/circle/rect data identical between the
// two files; only the rendering call changes.
//
// Every color defaults to `currentColor` rather than a fixed hex: unlike
// React Native, the browser resolves CSS custom properties for us, so an
// icon just inherits whatever color its container has.

const SVG_NS = "http://www.w3.org/2000/svg";

type IconShape = {
  paths?: string[];
  circles?: { cx: number; cy: number; r: number; filled?: boolean }[];
  rects?: { x: number; y: number; width: number; height: number; rx?: number }[];
  strokeWidth: number;
};

const ICONS = {
  chevronLeft: { paths: ["M15 5l-7 7 7 7"], strokeWidth: 1.9 },
  close: { paths: ["M6 6l12 12", "M18 6L6 18"], strokeWidth: 1.9 },
  plus: { paths: ["M4 12h16", "M12 4v16"], strokeWidth: 1.8 },
  search: { paths: ["M15.5 15.5L21 21"], circles: [{ cx: 10.5, cy: 10.5, r: 6.8 }], strokeWidth: 1.8 },
  chevronRight: { paths: ["M9 5l7 7-7 7"], strokeWidth: 1.8 },
  chevronDown: { paths: ["M6 9.5l6 6 6-6"], strokeWidth: 1.8 },
  copy: { paths: ["M15 5.5H5.5A1.5 1.5 0 0 0 4 7v9.5"], rects: [{ x: 9, y: 9, width: 12, height: 12, rx: 2.5 }], strokeWidth: 1.7 },
  reveal: {
    paths: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"],
    circles: [{ cx: 12, cy: 12, r: 2.6 }],
    strokeWidth: 1.7,
  },
  regenerate: {
    paths: ["M4 4v6h6", "M20 20v-6h-6", "M4.6 10a8 8 0 0 1 14-2.4", "M19.4 14a8 8 0 0 1-14 2.4"],
    strokeWidth: 1.7,
  },
  moreVertical: {
    circles: [
      { cx: 12, cy: 5.5, r: 1.4 },
      { cx: 12, cy: 12, r: 1.4 },
      { cx: 12, cy: 18.5, r: 1.4 },
    ],
    strokeWidth: 1.7,
  },
  heart: { paths: ["M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8.6 3.8 3.8 0 0 1 19 10.8C19 15.6 12 20 12 20z"], strokeWidth: 1.7 },
  edit: { paths: ["M15.5 4.5l4 4L9 19H5v-4z"], strokeWidth: 1.7 },
  trash: { paths: ["M4 7h16", "M9 7V4.5h6V7", "M6.5 7l1 13h9l1-13"], strokeWidth: 1.8 },
  grid: {
    rects: [
      { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 },
      { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 },
      { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 },
      { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 },
    ],
    strokeWidth: 1.8,
  },
  settingsGear: {
    circles: [{ cx: 12, cy: 12, r: 3.2 }],
    paths: ["M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"],
    strokeWidth: 1.7,
  },
  login: { paths: ["M11.4 12.6L19 5", "M15.5 8.5l2.5 2.5"], circles: [{ cx: 8.5, cy: 15.5, r: 4 }], strokeWidth: 1.7 },
  card: { paths: ["M2.5 10h19"], rects: [{ x: 2.5, y: 5.5, width: 19, height: 13, rx: 2.5 }], strokeWidth: 1.7 },
  identity: { paths: ["M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"], circles: [{ cx: 12, cy: 8, r: 3.6 }], strokeWidth: 1.7 },
  note: { paths: ["M6 3h8l4 4v14H6z", "M9 11h6", "M9 15h6"], strokeWidth: 1.7 },
  totp: { paths: ["M12 3l7.5 3v6c0 4.4-3.1 7.9-7.5 9.4C7.6 19.9 4.5 16.4 4.5 12V6z"], strokeWidth: 1.7 },
  info: { paths: ["M12 11v5.5"], circles: [{ cx: 12, cy: 12, r: 9.2 }, { cx: 12, cy: 7.8, r: 0.9, filled: true }], strokeWidth: 1.7 },
  alertTriangle: { paths: ["M12 4.4l8.4 14.6H3.6z", "M12 10v4.1", "M12 16.5v.2"], strokeWidth: 1.9 },
  lock: { paths: ["M8 10.5V8a4 4 0 0 1 8 0v2.5"], rects: [{ x: 4.5, y: 10.5, width: 15, height: 10, rx: 2 }], strokeWidth: 1.8 },
} as const satisfies Record<string, IconShape>;

type IconName = keyof typeof ICONS;

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A stroked 24x24 glyph from the redesign's hand-drawn set. */
export function icon(name: IconName, options: { size?: number; color?: string; strokeWidth?: number } = {}): SVGSVGElement {
  const size = options.size ?? 16;
  const color = options.color ?? "currentColor";
  const shape: IconShape = ICONS[name];
  const strokeWidth = options.strokeWidth ?? shape.strokeWidth;

  const svg = svgEl("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none" }) as SVGSVGElement;
  svg.setAttribute("aria-hidden", "true");

  for (const d of shape.paths ?? []) {
    svg.append(svgEl("path", { d, stroke: color, "stroke-width": strokeWidth, "stroke-linecap": "round", "stroke-linejoin": "round" }));
  }
  for (const c of shape.circles ?? []) {
    svg.append(
      svgEl("circle", {
        cx: c.cx,
        cy: c.cy,
        r: c.r,
        fill: c.filled === true ? color : "none",
        stroke: c.filled === true ? "none" : color,
        "stroke-width": strokeWidth,
      }),
    );
  }
  for (const r of shape.rects ?? []) {
    svg.append(svgEl("rect", { x: r.x, y: r.y, width: r.width, height: r.height, rx: r.rx ?? 0, stroke: color, fill: "none", "stroke-width": strokeWidth }));
  }
  return svg;
}

/**
 * The Vaultiq "three-spoke dial" mark -- see mobile/src/LogoMark.tsx for the
 * full description of the two variants. `simple` is for inline use next to
 * text (headings); `detailed` adds the outer guide ring and tick mark for
 * standalone use (this popup doesn't have a splash screen to use it on yet).
 */
export function logoMark(options: { size?: number; color?: string; tickColor?: string; variant?: "simple" | "detailed" } = {}): SVGSVGElement {
  const size = options.size ?? 26;
  const color = options.color ?? "currentColor";
  const tickColor = options.tickColor ?? color;

  const svg = svgEl("svg", { width: size, height: size, viewBox: "0 0 120 120" }) as SVGSVGElement;
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Vaultiq");

  if (options.variant === "detailed") {
    svg.append(
      svgEl("circle", { cx: 60, cy: 60, r: 57, fill: "none", stroke: tickColor, "stroke-width": 1.6, opacity: 0.6 }),
      svgEl("circle", { cx: 60, cy: 60, r: 49, fill: "none", stroke: color, "stroke-width": 6 }),
      svgEl("circle", { cx: 60, cy: 60, r: 33, fill: "none", stroke: color, "stroke-width": 3 }),
    );
    for (const rotate of [60, 180, 300]) {
      svg.append(svgEl("rect", { x: 56.5, y: 18, width: 7, height: 24, fill: color, transform: `rotate(${String(rotate)} 60 60)` }));
    }
    svg.append(svgEl("circle", { cx: 60, cy: 60, r: 13, fill: color }), svgEl("rect", { x: 57.5, y: 10, width: 5, height: 14, fill: tickColor }));
    return svg;
  }

  svg.append(
    svgEl("circle", { cx: 60, cy: 60, r: 51, fill: "none", stroke: color, "stroke-width": 10 }),
    svgEl("circle", { cx: 60, cy: 60, r: 31, fill: "none", stroke: color, "stroke-width": 4 }),
  );
  for (const rotate of [60, 180, 300]) {
    svg.append(svgEl("rect", { x: 56, y: 20, width: 8, height: 22, fill: color, transform: `rotate(${String(rotate)} 60 60)` }));
  }
  svg.append(svgEl("circle", { cx: 60, cy: 60, r: 13, fill: color }));
  return svg;
}

export type { IconName };
