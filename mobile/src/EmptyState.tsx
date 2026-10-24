import { StyleSheet, Text, View } from 'react-native';
import Icon from './icons';
import { colors, fonts, inkAlpha, spacing } from './theme';
import { Button } from './ui';

/**
 * "There is nothing here": what is missing, why that is fine, and what to do
 * next. One component, so every empty list reads as the same product.
 *
 * The ring is dashed on purpose -- an outline where something will go, not a
 * picture of something that is there.
 */
export default function EmptyState(props: {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  hint: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.art}>
        <Icon name={props.icon} size={30} color={colors.ink} />
      </View>
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.hint}>{props.hint}</Text>
      {props.actionLabel !== undefined && props.onAction !== undefined && (
        <View style={styles.action}>
          <Button title={props.actionLabel} onPress={props.onAction} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: spacing.lg * 1.5, paddingHorizontal: spacing.md, gap: spacing.sm },
  art: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: inkAlpha(0.35),
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { fontFamily: fonts.condensedBold, fontSize: 22, color: colors.ink, textAlign: 'center' },
  hint: { fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: colors.ink, textAlign: 'center', maxWidth: 300 },
  action: { marginTop: spacing.sm, alignSelf: 'center', maxWidth: 260, width: '100%', alignItems: 'stretch' },
});
