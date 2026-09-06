/** Shared building blocks for the styled screens (Join Vault, Unlock, Vault Home, Item Detail, Settings). */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  multiline?: boolean;
  keyboardType?: 'default' | 'number-pad';
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, props.error !== undefined && styles.inputError, props.multiline === true && styles.inputMultiline]}
          autoCapitalize={props.autoCapitalize ?? 'sentences'}
          autoCorrect={false}
          placeholder={props.placeholder}
          placeholderTextColor={colors.muted}
          secureTextEntry={props.secure === true && !revealed}
          multiline={props.multiline}
          keyboardType={props.keyboardType}
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

type DialogButton = {
  text: string;
  onPress?: () => void;
  /** Right-most, styled in `colors.danger` -- an irreversible action. */
  destructive?: boolean;
};

type DialogRequest = { title: string; message?: string; buttons: DialogButton[] };

/**
 * A themed stand-in for `Alert.alert`, which renders as the bare OS dialog
 * (unstyled gray, no relation to the app's palette). Pair with
 * `useConfirmDialog` below rather than rendering this directly.
 */
function ConfirmDialog(props: DialogRequest & { visible: boolean; onRequestClose: () => void }) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onRequestClose}>
      <Pressable style={styles.dialogBackdrop} onPress={props.onRequestClose}>
        <Pressable style={styles.dialogCard}>
          <Text style={styles.dialogTitle}>{props.title}</Text>
          {props.message !== undefined && <Text style={styles.dialogMessage}>{props.message}</Text>}
          <View style={styles.dialogButtons}>
            {props.buttons.map(button => (
              <Pressable
                key={button.text}
                style={styles.dialogButton}
                onPress={() => {
                  props.onRequestClose();
                  button.onPress?.();
                }}
              >
                <Text style={[styles.dialogButtonText, button.destructive === true && styles.dialogButtonTextDestructive]}>
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Imperative-feeling drop-in for `Alert.alert(title, message, buttons)`:
 * call `show(title, message, buttons)` from an event handler, and render
 * the returned `dialog` element anywhere in that component's tree.
 */
function useConfirmDialog(): { show: (title: string, message: string | undefined, buttons: DialogButton[]) => void; dialog: React.ReactNode } {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const show = (title: string, message: string | undefined, buttons: DialogButton[]) => {
    setRequest({ title, message, buttons });
  };

  const dialog = (
    <ConfirmDialog
      visible={request !== null}
      title={request?.title ?? ''}
      message={request?.message}
      buttons={request?.buttons ?? [{ text: 'OK' }]}
      onRequestClose={() => setRequest(null)}
    />
  );

  return { show, dialog };
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
  inputMultiline: {
    minHeight: 100,
    textAlignVertical: 'top',
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
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.heading,
  },
  dialogMessage: {
    fontSize: 14,
    color: colors.text,
  },
  dialogButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  dialogButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  dialogButtonText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  dialogButtonTextDestructive: {
    color: colors.danger,
  },
});

export { Card, Chip, ConfirmDialog, DetailField, Field, PillButton, SectionLabel, useConfirmDialog };
export type { DialogButton };
