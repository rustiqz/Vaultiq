/**
 * Shared building blocks for the redesign v2 visual system (CLAUDE.md §0) --
 * every screen is built from these rather than styling its own inputs,
 * buttons and dialogs.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Icon from './icons';
import { colors, fonts, inkAlpha, radii, spacing } from './theme';

function Field(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'number-pad' | 'email-address';
  multiline?: boolean;
  optional?: boolean;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.label}>{props.label}</Text>
        {props.optional === true && <Text style={styles.optional}>Optional</Text>}
      </View>
      <TextInput
        style={[styles.input, props.multiline === true && styles.inputMultiline, props.error !== undefined && styles.inputError]}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        keyboardType={props.keyboardType}
        multiline={props.multiline}
        placeholder={props.placeholder}
        placeholderTextColor={inkAlpha(0.45)}
        value={props.value}
        onChangeText={props.onChangeText}
      />
      {props.error !== undefined && <Text style={styles.fieldError}>{props.error}</Text>}
      {props.error === undefined && props.hint !== undefined && <Text style={styles.hint}>{props.hint}</Text>}
    </View>
  );
}

/**
 * The "high-value field" from design rule 3: a 62px surface with a 2px ink
 * border, mono text, and reveal/copy as their own 44-56px buttons -- used
 * for passwords, secrets and anything else worth a dedicated action rather
 * than a plain text field.
 */
function SecretField(props: {
  label: string;
  value: string;
  onChangeText?: (text: string) => void;
  editable?: boolean;
  onCopy?: () => void;
  hint?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const { copied, markCopied } = useCopiedFeedback();
  const editable = props.editable ?? props.onChangeText !== undefined;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.secretBox}>
        {copied ? (
          <Text style={[styles.secretInput, styles.copiedValue]}>Copied</Text>
        ) : editable ? (
          <TextInput
            style={styles.secretInput}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!revealed}
            value={props.value}
            onChangeText={props.onChangeText}
          />
        ) : (
          <Text style={styles.secretInput} numberOfLines={1}>
            {revealed ? props.value : '•'.repeat(Math.min(props.value.length, 14))}
          </Text>
        )}
        <Pressable style={styles.secretAction} onPress={() => setRevealed(r => !r)} accessibilityRole="button" accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${props.label}`}>
          {/* No separate closed-eye glyph in the design -- the toggle reuses this one. */}
          <Icon name="reveal" size={19} color={colors.ink} />
        </Pressable>
        {props.onCopy !== undefined && (
          <Pressable
            style={[styles.secretAction, styles.secretActionFilled]}
            accessibilityRole="button"
            accessibilityLabel={`Copy ${props.label}`}
            onPress={() => {
              props.onCopy?.();
              markCopied();
            }}
          >
            <Icon name="copy" size={18} color={colors.onInk} />
          </Pressable>
        )}
      </View>
      {props.hint !== undefined && <Text style={styles.hint}>{props.hint}</Text>}
    </View>
  );
}

function Button(props: { title: string; onPress: () => void; disabled?: boolean; variant?: 'solid' | 'outline'; flex?: boolean }) {
  const outline = props.variant === 'outline';
  return (
    <Pressable
      style={[
        styles.button,
        outline ? styles.buttonOutline : styles.buttonSolid,
        props.disabled === true && styles.buttonDisabled,
        props.flex === true && styles.buttonFlex,
      ]}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text style={[styles.buttonText, outline ? styles.buttonTextOutline : styles.buttonTextSolid]}>{props.title}</Text>
    </Pressable>
  );
}

function Chip(props: { label: string; icon?: Parameters<typeof Icon>[0]['name']; onPress: () => void }) {
  return (
    <Pressable style={styles.chip} onPress={props.onPress}>
      {props.icon !== undefined && <Icon name={props.icon} size={14} color={colors.ink} strokeWidth={2.2} />}
      <Text style={styles.chipText}>{props.label}</Text>
    </Pressable>
  );
}

function SearchBar(props: { value: string; onChangeText: (text: string) => void; placeholder: string }) {
  return (
    <View style={styles.searchBar}>
      <Icon name="search" size={18} color={colors.ink} />
      <TextInput
        style={styles.searchInput}
        placeholder={props.placeholder}
        placeholderTextColor={inkAlpha(0.55)}
        value={props.value}
        onChangeText={props.onChangeText}
      />
    </View>
  );
}

/** A standard 54px detail field with dedicated 44px reveal/copy targets. */
function DetailField(props: { label: string; value: string; secure?: boolean; onCopy?: () => void; link?: boolean; multiline?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const { copied, markCopied } = useCopiedFeedback();
  if (props.value === '') return null;
  const shown = props.secure === true && !revealed ? '•'.repeat(Math.min(props.value.length, 12)) : props.value;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={[styles.detailRow, props.multiline === true && styles.detailRowMultiline]}>
        <Text style={[styles.detailValue, props.link === true && styles.detailValueLink]} numberOfLines={props.multiline === true ? undefined : 1}>
          {copied ? 'Copied' : shown}
        </Text>
        <View style={styles.detailActions}>
          {props.secure === true && (
            <Pressable style={styles.detailAction} onPress={() => setRevealed(r => !r)} accessibilityRole="button" accessibilityLabel={`${revealed ? 'Hide' : 'Show'} ${props.label}`}>
              <Icon name="reveal" size={16} color={colors.ink} />
            </Pressable>
          )}
          {props.onCopy !== undefined && (
            <Pressable
              style={styles.detailAction}
              accessibilityRole="button"
              accessibilityLabel={`Copy ${props.label}`}
              onPress={() => {
                props.onCopy?.();
                markCopied();
              }}
            >
              <Icon name="copy" size={16} color={colors.ink} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function useCopiedFeedback(): { copied: boolean; markCopied: () => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const markCopied = () => {
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return { copied, markCopied };
}

/** A small uppercase section label -- e.g. "DEVICES", "SECURITY", "LOGINS · 6". */
function SectionLabel(props: { children: string }) {
  return <Text style={styles.sectionLabel}>{props.children}</Text>;
}

/** The card shell every grouped row (device list, settings group, item row) sits in. */
function Card(props: { children: React.ReactNode; onPress?: () => void; style?: object }) {
  const Wrapper = props.onPress !== undefined ? Pressable : View;
  return (
    <Wrapper style={[styles.card, props.style]} onPress={props.onPress}>
      {props.children}
    </Wrapper>
  );
}

/** The "not built yet" dial from 6z: a dashed middle ring, spokes not drawn in. */
function PendingGlyph() {
  return (
    <Svg width={54} height={54} viewBox="0 0 120 120" aria-hidden>
      <Circle cx={60} cy={60} r={55} fill="none" stroke={colors.sage} strokeWidth={3} />
      <Circle cx={60} cy={60} r={40} fill="none" stroke={colors.sage} strokeWidth={3} strokeDasharray="6 8" />
      <Circle cx={60} cy={60} r={13} fill="none" stroke={colors.ink} strokeWidth={4} />
    </Svg>
  );
}

type DialogButton = {
  text: string;
  onPress?: () => void;
  /** Full-width filled rust button -- an irreversible action. */
  destructive?: boolean;
};

type DialogRequest = { title: string; message?: string; buttons: DialogButton[]; icon?: 'pending' };

/**
 * A themed stand-in for `Alert.alert`, matching the redesign's dialog anatomy
 * (6x/6y/6z): centered card, title + message, then full-width stacked
 * buttons -- not a native OS dialog, and not the old right-aligned text-link
 * button row either. Pair with `useConfirmDialog` rather than rendering
 * this directly.
 */
function ConfirmDialog(props: DialogRequest & { visible: boolean; onRequestClose: () => void }) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onRequestClose}>
      <Pressable style={styles.dialogBackdrop} onPress={props.onRequestClose}>
        <Pressable style={styles.dialogCard}>
          {props.icon === 'pending' && (
            <View style={styles.dialogIcon}>
              <PendingGlyph />
            </View>
          )}
          <View style={[styles.dialogText, props.icon === 'pending' && styles.dialogTextCentered]}>
            <Text style={[styles.dialogTitle, props.icon === 'pending' && styles.dialogTitleCentered]}>{props.title}</Text>
            {props.message !== undefined && (
              <Text style={[styles.dialogMessage, props.icon === 'pending' && styles.dialogTitleCentered]}>{props.message}</Text>
            )}
          </View>
          <View style={styles.dialogButtons}>
            {props.buttons.map(button => (
              <Pressable
                key={button.text}
                style={[styles.dialogButton, button.destructive === true ? styles.dialogButtonDestructive : styles.dialogButtonOutline]}
                onPress={() => {
                  props.onRequestClose();
                  button.onPress?.();
                }}
              >
                <Text style={[styles.dialogButtonText, button.destructive === true ? styles.dialogButtonTextDestructive : styles.dialogButtonTextOutline]}>
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
function useConfirmDialog(): {
  show: (title: string, message: string | undefined, buttons: DialogButton[], icon?: 'pending') => void;
  dialog: React.ReactNode;
} {
  const [request, setRequest] = useState<DialogRequest | null>(null);

  const show = (title: string, message: string | undefined, buttons: DialogButton[], icon?: 'pending') => {
    setRequest({ title, message, buttons, icon });
  };

  const dialog = (
    <ConfirmDialog
      visible={request !== null}
      title={request?.title ?? ''}
      message={request?.message}
      buttons={request?.buttons ?? [{ text: 'OK' }]}
      icon={request?.icon}
      onRequestClose={() => setRequest(null)}
    />
  );

  return { show, dialog };
}

/** The "Not built yet" stub, matching 6z exactly -- names the feature, says nothing broke. */
function showComingSoon(show: ReturnType<typeof useConfirmDialog>['show'], feature: string): void {
  show('Not built yet', `${feature} is on the roadmap for a future release. Nothing was changed.`, [{ text: 'Got it' }], 'pending');
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs + 3,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  label: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  optional: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  input: {
    minHeight: 54,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.2),
    borderRadius: radii.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 15.5,
    color: colors.ink,
  },
  inputMultiline: {
    minHeight: 120,
    paddingVertical: 14,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: colors.rust,
  },
  fieldError: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.rust,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.ink,
  },
  secretBox: {
    minHeight: 62,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.ink,
    borderRadius: radii.input,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  secretInput: {
    flex: 1,
    paddingHorizontal: 14,
    fontFamily: fonts.mono,
    fontSize: 17,
    letterSpacing: 1,
    color: colors.ink,
    textAlignVertical: 'center',
  },
  copiedValue: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 15.5,
    letterSpacing: 0,
  },
  secretAction: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: inkAlpha(0.16),
  },
  secretActionFilled: {
    width: 56,
    backgroundColor: colors.ink,
    borderLeftWidth: 0,
  },
  button: {
    minHeight: 54,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonSolid: {
    backgroundColor: colors.ink,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 15,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  buttonTextSolid: {
    color: colors.onInk,
  },
  buttonTextOutline: {
    color: colors.ink,
  },
  chip: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 3,
  },
  chipText: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  searchBar: {
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: radii.input,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  sectionLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.14),
  },
  detailRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: inkAlpha(0.16),
    borderRadius: radii.input,
    paddingLeft: 14,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  detailRowMultiline: {
    alignItems: 'flex-start',
    minHeight: 120,
  },
  detailValue: {
    flex: 1,
    paddingVertical: 14,
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 15.5,
  },
  detailValueLink: {
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  detailActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
  },
  detailAction: {
    width: 44,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: inkAlpha(0.14),
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 322,
    backgroundColor: colors.background,
    borderRadius: radii.dialog,
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 20,
    gap: spacing.md,
  },
  dialogIcon: {
    alignSelf: 'center',
  },
  dialogText: {
    gap: spacing.sm,
  },
  dialogTextCentered: {
    alignItems: 'center',
  },
  dialogTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 27,
    lineHeight: 30,
    color: colors.ink,
  },
  dialogTitleCentered: {
    textAlign: 'center',
  },
  dialogMessage: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
  dialogButtons: {
    gap: spacing.sm + 1,
  },
  dialogButton: {
    height: 52,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogButtonDestructive: {
    backgroundColor: colors.rust,
  },
  dialogButtonOutline: {
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  dialogButtonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dialogButtonTextDestructive: {
    color: colors.onInk,
  },
  dialogButtonTextOutline: {
    color: colors.ink,
  },
});

export { Button, Card, Chip, ConfirmDialog, DetailField, Field, SearchBar, SecretField, SectionLabel, showComingSoon, useConfirmDialog };
export type { DialogButton };
