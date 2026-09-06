import Svg, { Circle, G, Rect } from 'react-native-svg';

/**
 * The Vaultiq "three-spoke dial" mark, from the redesign canvas
 * ("Vaultiq Mobile Redesign v2.dc.html", id 6a/6b/6d) -- replaces the old
 * shield glyph everywhere: splash, unlock, headers, Settings' vault row.
 *
 * `variant="detailed"` adds the thin outer guide ring and the small tick
 * mark (splash/unlock, where the dial is the only thing on screen);
 * `variant="simple"` is the plain three-ring-and-spokes version used small,
 * inline with text (headers, list rows).
 */
function LogoMark(props: { size?: number; color?: string; tickColor?: string; variant?: 'simple' | 'detailed' }) {
  const size = props.size ?? 26;
  const color = props.color ?? '#674636';
  const variant = props.variant ?? 'simple';

  if (variant === 'detailed') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Vaultiq dial">
        <Circle cx={60} cy={60} r={57} fill="none" stroke={props.tickColor ?? color} strokeWidth={1.6} opacity={0.6} />
        <Circle cx={60} cy={60} r={49} fill="none" stroke={color} strokeWidth={6} />
        <Circle cx={60} cy={60} r={33} fill="none" stroke={color} strokeWidth={3} />
        <G fill={color}>
          <Rect x={56.5} y={18} width={7} height={24} transform="rotate(60 60 60)" />
          <Rect x={56.5} y={18} width={7} height={24} transform="rotate(180 60 60)" />
          <Rect x={56.5} y={18} width={7} height={24} transform="rotate(300 60 60)" />
        </G>
        <Circle cx={60} cy={60} r={13} fill={color} />
        <Rect x={57.5} y={10} width={5} height={14} fill={props.tickColor ?? color} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <Circle cx={60} cy={60} r={51} fill="none" stroke={color} strokeWidth={10} />
      <Circle cx={60} cy={60} r={31} fill="none" stroke={color} strokeWidth={4} />
      <G fill={color}>
        <Rect x={56} y={20} width={8} height={22} transform="rotate(60 60 60)" />
        <Rect x={56} y={20} width={8} height={22} transform="rotate(180 60 60)" />
        <Rect x={56} y={20} width={8} height={22} transform="rotate(300 60 60)" />
      </G>
      <Circle cx={60} cy={60} r={13} fill={color} />
    </Svg>
  );
}

export default LogoMark;
