/** Shared building blocks for the styled screens (Join Vault, Unlock, Vault Home, Item Detail, Settings). */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Icon from './icons';
import { colors, radii, spacing } from './theme';

function Field(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secure?: boolean;
  error?: string;
  autoCapitalize?: 'none' | 'sentences';
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, props.error !== undefined && styles.inputError]}
          autoCapitalize={props.autoCapitalize ?? 'sentences'}
          autoCorrect={false}
          placeholder={props.placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={props.secure === true && !revealed}
          value={props.value}
          onChangeText={props.onChangeText}
        />
        {props.secure === true && (
          <Pressable style={styles.inputAction} onPress={() => setRevealed(r => !r)}>
            <Icon name={revealed ? 'eye-off' : 'eye'} size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {props.error !== undefined && <Text style={styles.fieldError}>{props.error}</Text>}
    </View>
  );
}

function PillButton(props: { title: string; onPress: () => void; disabled?: boolean; variant?: 'solid' | 'outline' }) {
  const outline = props.variant === 'outline';
  return (
    <Pressable
      style={[styles.pillButton, outline && styles.pillButtonOutline, props.disabled === true && styles.pillButtonDisabled]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={[styles.pillButtonText, outline && styles.pillButtonTextOutline]}>{props.title}</Text>
    </Pressable>
  );
}

function Chip(props: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, props.active && styles.chipActive]} onPress={props.onPress}>
      <Text style={[styles.chipText, props.active && styles.chipTextActive]}>{props.label}</Text>
    </Pressable>
  );
}

/** A read-only labelled value in a card-styled row, optionally maskable and/or copyable. */
function DetailField(props: {
  label: string;
  value: string;
  secure?: boolean;
  onCopy?: () => void;
  link?: boolean;
  multiline?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  if (props.value === '') return null;
  const shown = props.secure === true && !revealed ? '•'.repeat(Math.min(props.value.length, 12)) : props.value;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={[styles.detailRow, props.multiline === true && styles.detailRowMultiline]}>
        <Text
          style={[styles.detailValue, props.link === true && styles.detailValueLink]}
          numberOfLines={props.multiline === true ? undefined : 1}
        >
          {shown}
        </Text>
        <View style={styles.detailActions}>
          {props.link === true && <Icon name="external-link" size={16} color={colors.primary} />}
          {props.secure === true && (
            <Pressable onPress={() => setRevealed(r => !r)}>
              <Icon name={revealed ? 'eye-off' : 'eye'} size={16} color={colors.muted} />
            </Pressable>
          )}
          {props.onCopy !== undefined && (
            <Pressable onPress={props.onCopy}>
              <Icon name="copy" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

/** A small uppercase section label, e.g. "DEVICES" / "SECURITY" on Settings. */
function SectionLabel(props: { children: string }) {
  return <Text style={styles.sectionLabel}>{props.children}</Text>;
}

/** The card shell every row on Vault Home / Settings sits in. */
function Card(props: { children: React.ReactNode; onPress?: () => void }) {
  const Wrapper = props.onPress !== undefined ? Pressable : View;
  return (
    <Wrapper style={styles.card} onPress={props.onPress}>
      {props.children}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: spacing.sm + 4,
    backgroundColor: colors.card,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputAction: {
    position: 'absolute',
    right: spacing.sm + 4,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 12,
  },
  pillButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  pillButtonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  pillButtonDisabled: {
    opacity: 0.6,
  },
  pillButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  pillButtonTextOutline: {
    color: colors.danger,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.card,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.input,
    padding: spacing.sm + 4,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  detailRowMultiline: {
    alignItems: 'flex-start',
    minHeight: 120,
  },
  detailValue: {
    flex: 1,
    color: colors.text,
  },
  detailValueLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
  },
});

export { Card, Chip, DetailField, Field, PillButton, SectionLabel };
