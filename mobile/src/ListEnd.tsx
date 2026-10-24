import { StyleSheet, Text, View } from 'react-native';
import LogoMark from './LogoMark';
import { colors, fonts, spacing } from './theme';

/**
 * The last thing under a list: a small mark and one line that says there is
 * nothing further down, so a person is never left wondering whether more is
 * still loading. Only shown when the list has rows -- an empty list has its
 * own `EmptyState`.
 */
export default function ListEnd(props: { text: string }) {
  return (
    <View style={styles.container} accessible accessibilityLabel={props.text}>
      <LogoMark size={22} variant="micro" color={colors.ink} />
      <Text style={styles.text}>{props.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.lg * 1.5, paddingBottom: spacing.md, paddingHorizontal: spacing.md },
  text: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.ink, textAlign: 'center', maxWidth: 280 },
});
