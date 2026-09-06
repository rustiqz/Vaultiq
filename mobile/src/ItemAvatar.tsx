import { StyleSheet, Text, View } from 'react-native';
import Icon, { type IconName } from './icons';
import { displayName, text } from './itemContent';
import { colors, fonts } from './theme';

const TYPE_ICON: Record<string, IconName> = {
  card: 'card',
  note: 'note',
  totp: 'totp',
};

/**
 * The redesign's avatar rule: item types use their icon, except people and
 * services, which use initials -- two letters for an identity, one letter
 * (a favicon fallback, since there's no real favicon fetch here) for a
 * login. Card/Note/TOTP fall back to their type glyph.
 */
function ItemAvatar(props: { itemType: string; content: Record<string, unknown>; id: string; size?: number }) {
  const size = props.size ?? 40;

  if (props.itemType === 'identity') {
    const first = text(props.content, 'firstName');
    const last = text(props.content, 'lastName');
    const initials = `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase() || displayName(props.itemType, props.content, props.id).slice(0, 2).toUpperCase();
    return (
      <View style={[styles.base, styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initials}</Text>
      </View>
    );
  }

  if (props.itemType === 'login') {
    const initial = displayName(props.itemType, props.content, props.id).slice(0, 1).toUpperCase();
    return (
      <View style={[styles.base, styles.square, { width: size, height: size, borderRadius: size * 0.25 }]}>
        <Text style={[styles.initials, { fontSize: size * 0.4 }]}>{initial}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.base, styles.square, { width: size, height: size, borderRadius: size * 0.25 }]}>
      <Icon name={TYPE_ICON[props.itemType] ?? 'note'} size={size * 0.5} color={colors.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  square: {
    borderColor: 'rgba(103, 70, 54, 0.14)',
  },
  circle: {
    borderColor: 'rgba(103, 70, 54, 0.14)',
  },
  initials: {
    fontFamily: fonts.semiCondensedBold,
    color: colors.ink,
  },
});

export default ItemAvatar;
