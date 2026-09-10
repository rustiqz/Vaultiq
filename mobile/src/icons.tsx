import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from './theme';

/**
 * The redesign's hand-drawn icon set, extracted from "Vaultiq Mobile
 * Redesign v2.dc.html" -- replaces the old Feather-icon wrapper. Every icon
 * there is a plain 24x24 stroked glyph; this mirrors that shape exactly
 * rather than substituting a lookalike from a different icon set.
 *
 * There's no separate "hide" glyph in the design -- the reveal toggle reuses
 * the same eye icon for both states (see SecretField in ui.tsx).
 */
type IconShape = {
  paths?: string[];
  circles?: { cx: number; cy: number; r: number; filled?: boolean }[];
  rects?: { x: number; y: number; width: number; height: number; rx?: number }[];
  strokeWidth: number;
};

const ICONS = {
  chevronLeft: { paths: ['M15 5l-7 7 7 7'], strokeWidth: 1.9 },
  close: { paths: ['M6 6l12 12', 'M18 6L6 18'], strokeWidth: 1.9 },
  plus: { paths: ['M4 12h16', 'M12 4v16'], strokeWidth: 1.8 },
  search: { paths: ['M15.5 15.5L21 21'], circles: [{ cx: 10.5, cy: 10.5, r: 6.8 }], strokeWidth: 1.8 },
  chevronRight: { paths: ['M9 5l7 7-7 7'], strokeWidth: 1.8 },
  chevronDown: { paths: ['M6 9.5l6 6 6-6'], strokeWidth: 1.8 },
  copy: { paths: ['M15 5.5H5.5A1.5 1.5 0 0 0 4 7v9.5'], rects: [{ x: 9, y: 9, width: 12, height: 12, rx: 2.5 }], strokeWidth: 1.7 },
  reveal: {
    paths: ['M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z'],
    circles: [{ cx: 12, cy: 12, r: 2.6 }],
    strokeWidth: 1.7,
  },
  regenerate: {
    paths: ['M4 4v6h6', 'M20 20v-6h-6', 'M4.6 10a8 8 0 0 1 14-2.4', 'M19.4 14a8 8 0 0 1-14 2.4'],
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
  heart: { paths: ['M12 20s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8.6 3.8 3.8 0 0 1 19 10.8C19 15.6 12 20 12 20z'], strokeWidth: 1.7 },
  edit: { paths: ['M15.5 4.5l4 4L9 19H5v-4z'], strokeWidth: 1.7 },
  trash: { paths: ['M4 7h16', 'M9 7V4.5h6V7', 'M6.5 7l1 13h9l1-13'], strokeWidth: 1.8 },
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
    paths: ['M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1'],
    strokeWidth: 1.7,
  },
  login: { paths: ['M11.4 12.6L19 5', 'M15.5 8.5l2.5 2.5'], circles: [{ cx: 8.5, cy: 15.5, r: 4 }], strokeWidth: 1.7 },
  card: { paths: ['M2.5 10h19'], rects: [{ x: 2.5, y: 5.5, width: 19, height: 13, rx: 2.5 }], strokeWidth: 1.7 },
  identity: { paths: ['M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6'], circles: [{ cx: 12, cy: 8, r: 3.6 }], strokeWidth: 1.7 },
  note: { paths: ['M6 3h8l4 4v14H6z', 'M9 11h6', 'M9 15h6'], strokeWidth: 1.7 },
  totp: { paths: ['M12 3l7.5 3v6c0 4.4-3.1 7.9-7.5 9.4C7.6 19.9 4.5 16.4 4.5 12V6z'], strokeWidth: 1.7 },
  fingerprint: {
    paths: [
      'M12 3.5c2.5 0 4.5 1.2 5.5 2.5',
      'M6.5 6C7.5 4.7 9.5 3.5 12 3.5',
      'M4.5 10.5C5 8.8 6 7.4 7.2 6.6',
      'M12 20.5c-2-1.6-3-4-3-6.5a3 3 0 0 1 6 0c0 1.2.3 2.3.8 3',
      'M19.5 10.5c.3 1.6.2 3.4-.4 5',
    ],
    strokeWidth: 1.7,
  },
  info: { paths: ['M12 11v5.5'], circles: [{ cx: 12, cy: 12, r: 9.2 }, { cx: 12, cy: 7.8, r: 0.9, filled: true }], strokeWidth: 1.7 },
  alertTriangle: { paths: ['M12 4.4l8.4 14.6H3.6z', 'M12 10v4.1', 'M12 16.5v.2'], strokeWidth: 1.9 },
  import: {
    paths: ['M12 16V4', 'M7.5 8.5L12 4l4.5 4.5', 'M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15'],
    strokeWidth: 1.8,
  },
  scan: {
    paths: ['M9 4H5a1 1 0 0 0-1 1v4', 'M15 4h4a1 1 0 0 1 1 1v4', 'M20 15v4a1 1 0 0 1-1 1h-4', 'M9 20H5a1 1 0 0 1-1-1v-4', 'M7 12h10'],
    strokeWidth: 1.8,
  },
  smartphone: { paths: ['M10.5 18h3'], rects: [{ x: 7, y: 3, width: 10, height: 18, rx: 2 }], strokeWidth: 1.7 },
  monitor: { paths: ['M9 20h6'], rects: [{ x: 2.5, y: 5, width: 19, height: 12, rx: 2 }], strokeWidth: 1.7 },
  lock: { paths: ['M8 10.5V8a4 4 0 0 1 8 0v2.5'], rects: [{ x: 4.5, y: 10.5, width: 15, height: 10, rx: 2 }], strokeWidth: 1.8 },
} as const satisfies Record<string, IconShape>;

type IconName = keyof typeof ICONS;

function Icon(props: { name: IconName; size?: number; color?: string; strokeWidth?: number; filled?: boolean }) {
  const size = props.size ?? 20;
  const color = props.color ?? colors.ink;
  const shape: IconShape = ICONS[props.name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {shape.paths?.map(d => (
        <Path
          key={d}
          d={d}
          fill={props.filled === true ? color : 'none'}
          stroke={color}
          strokeWidth={props.strokeWidth ?? shape.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {shape.circles?.map(c => (
        <Circle
          key={`${c.cx}-${c.cy}-${c.r}`}
          cx={c.cx}
          cy={c.cy}
          r={c.r}
          fill={c.filled === true ? color : 'none'}
          stroke={c.filled === true ? 'none' : color}
          strokeWidth={props.strokeWidth ?? shape.strokeWidth}
        />
      ))}
      {shape.rects?.map(r => (
        <Rect
          key={`${r.x}-${r.y}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={r.rx}
          stroke={color}
          strokeWidth={props.strokeWidth ?? shape.strokeWidth}
        />
      ))}
    </Svg>
  );
}

export default Icon;
export type { IconName };
