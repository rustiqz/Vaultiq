import { Feather } from '@react-native-vector-icons/feather';
import type { ComponentProps } from 'react';
import { colors } from './theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** Thin wrapper fixing the default size/color to the app's usual icon look. */
function Icon(props: { name: FeatherName; size?: number; color?: string }) {
  return <Feather name={props.name} size={props.size ?? 20} color={props.color ?? colors.text} />;
}

export default Icon;
export type { FeatherName };
