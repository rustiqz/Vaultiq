import type { ColorValue } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

type LogoVariant = 'primary' | 'compact' | 'micro' | 'mono' | 'locked' | 'syncing';

/** Production Vaultiq dial geometry, ported directly from the supplied SVG set. */
function LogoMark(props: { size?: number; color?: ColorValue; stateColor?: ColorValue; variant?: LogoVariant }) {
  const size = props.size ?? 26;
  const color = props.color ?? '#674636';
  const stateColor = props.stateColor ?? '#AAB396';
  const variant = props.variant ?? 'compact';

  if (variant === 'micro') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
        <Circle cx={60} cy={60} r={50} fill="none" stroke={color} strokeWidth={13} />
        <Spokes color={color} x={55} y={24} width={10} height={20} />
        <Circle cx={60} cy={60} r={14} fill={color} />
      </Svg>
    );
  }

  if (variant === 'compact') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
        <Circle cx={60} cy={60} r={51} fill="none" stroke={color} strokeWidth={10} />
        <Circle cx={60} cy={60} r={31} fill="none" stroke={color} strokeWidth={4} />
        <Spokes color={color} x={56} y={20} width={8} height={22} />
        <Circle cx={60} cy={60} r={13} fill={color} />
      </Svg>
    );
  }

  if (variant === 'locked' || variant === 'syncing') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`Vaultiq ${variant}`}>
        <Circle cx={60} cy={60} r={49} fill="none" stroke={color} strokeWidth={7} />
        <Circle cx={60} cy={60} r={31} fill="none" stroke={color} strokeWidth={3.5} />
        <Spokes color={color} x={56} y={20} width={8} height={22} offset={variant === 'syncing' ? -2 : 0} />
        <Circle cx={60} cy={60} r={13} fill={color} />
        {variant === 'locked' ? (
          <Rect x={57.5} y={4} width={5} height={14} fill={stateColor} />
        ) : (
          <Path d="M60 11 A49 49 0 0 1 106 44" fill="none" stroke={stateColor} strokeWidth={5} />
        )}
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Vaultiq">
      {variant === 'primary' && <Circle cx={60} cy={60} r={57} fill="none" stroke={stateColor} strokeWidth={1.5} />}
      <Circle cx={60} cy={60} r={49} fill="none" stroke={color} strokeWidth={6} />
      <Circle cx={60} cy={60} r={33} fill="none" stroke={color} strokeWidth={3} />
      <Spokes color={color} x={56.5} y={18} width={7} height={24} />
      <Circle cx={60} cy={60} r={13} fill={color} />
      <Rect x={57.5} y={10} width={5} height={14} fill={variant === 'primary' ? stateColor : color} />
    </Svg>
  );
}

function Spokes(props: { color: ColorValue; x: number; y: number; width: number; height: number; offset?: number }) {
  const offset = props.offset ?? 0;
  return (
    <G fill={props.color}>
      {[60, 180, 300].map(rotation => (
        <Rect
          key={rotation}
          x={props.x}
          y={props.y}
          width={props.width}
          height={props.height}
          transform={`rotate(${rotation + offset} 60 60)`}
        />
      ))}
    </G>
  );
}

export default LogoMark;
export type { LogoVariant };
