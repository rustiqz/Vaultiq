/** Shared building blocks for the styled screens (Join Vault, Unlock, Vault Home, Item Detail, Settings). */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
          <Pressable style={styles.reveal} onPress={() => setRevealed(r => !r)}>
            <Text style={styles.revealText}>{revealed ? 'Hide' : 'Show'}</Text>
          </Pressable>
        )}
      </View>
      {props.error !== undefined && <Text style={styles.fieldError}>{props.error}</Text>}
    </View>
  );
}

function PillButton(props: { title: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable
      style={[
        styles.pillButton,
        props.danger === true && styles.pillButtonDanger,
        props.disabled === true && styles.pillButtonDisabled,
      ]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={styles.pillButtonText}>{props.title}</Text>
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

/** A read-only labelled value, optionally maskable and/or copyable -- the item-detail equivalent of Field. */
function DetailField(props: { label: string; value: string; secure?: boolean; onCopy?: () => void }) {
  const [revealed, setRevealed] = useState(false);
  if (props.value === '') return null;
  const shown = props.secure === true && !revealed ? '•'.repeat(Math.min(props.value.length, 12)) : props.value;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.detailRow}>
        <Text style={styles.detailValue}>{shown}</Text>
        <View style={styles.detailActions}>
          {props.secure === true && (
            <Pressable onPress={() => setRevealed(r => !r)}>
              <Text style={styles.revealText}>{revealed ? 'Hide' : 'Show'}</Text>
            </Pressable>
          )}
          {props.onCopy !== undefined && (
            <Pressable onPress={props.onCopy}>
              <Text style={styles.revealText}>Copy</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.heading,
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
    backgroundColor: colors.surface,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  reveal: {
    position: 'absolute',
    right: spacing.sm + 4,
  },
  revealText: {
    color: colors.primary,
    fontWeight: '600',
    fontSize: 13,
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
  pillButtonDanger: {
    backgroundColor: colors.danger,
  },
  pillButtonDisabled: {
    opacity: 0.6,
  },
  pillButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.chip,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.surface,
  },
  detailValue: {
    flex: 1,
    color: colors.text,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});

export { Chip, DetailField, Field, PillButton };
