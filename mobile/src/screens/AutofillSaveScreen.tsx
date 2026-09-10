import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import LogoMark from '../LogoMark';
import Autofill from '../nativeAutofill';
import { colors, fonts, spacing } from '../theme';
import { Button, DetailField, Field, SecretField } from '../ui';
import * as vault from '../vault';

/**
 * The sheet `AutofillActivity` shows in save mode -- opened from
 * `VaultiqAutofillService.onSaveRequest` after Android's own "Save to
 * Vaultiq?" system prompt was accepted. No reference mockup exists for this
 * one (only the fill picker, 6aa, was designed) -- built to match its same
 * bottom-sheet language rather than the earlier full-screen form. Just
 * confirms and calls the existing `vault.addItem`; nothing here is
 * autofill-specific once the values are in hand.
 */
export default function AutofillSaveScreen(props: { domain: string; caller: string; callerVerified: boolean; username: string; password: string }) {
  const [name, setName] = useState(props.domain || props.caller);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await vault.addItem({ type: 'login', name, username: props.username, password: props.password, url: props.domain });
      await Autofill.completeSave();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.scrim} onPress={() => Autofill.discardSave()} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <LogoMark variant="compact" size={28} color={colors.ink} />
          <View style={styles.headerText}>
            <Text style={styles.wordmark}>Vaultiq</Text>
            <View style={styles.subtitleRow}>
              {!props.callerVerified && <Icon name="alertTriangle" size={12} color={colors.amber} />}
              <Text style={styles.subtitle} numberOfLines={1}>
                {props.callerVerified ? `Save this login for ${props.caller}?` : `Not a verified website — ${props.caller}`}
              </Text>
            </View>
          </View>
          <Pressable style={styles.closeButton} onPress={() => Autofill.discardSave()} hitSlop={8}>
            <Icon name="close" size={18} color={colors.ink} />
          </Pressable>
        </View>

        <View style={styles.fields}>
          <Field label="Name" value={name} onChangeText={setName} placeholder={props.domain} />
          <DetailField label="Username" value={props.username} />
          <SecretField label="Password" value={props.password} />
        </View>
        {error !== null && <Text style={styles.error}>{error}</Text>}

        <View style={styles.buttons}>
          <Button title="Discard" variant="outline" disabled={busy} onPress={() => Autofill.discardSave()} />
          <Button title={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={save} flex />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
  },
  sheet: {
    marginTop: 'auto',
    backgroundColor: colors.background,
    borderTopWidth: 3,
    borderTopColor: colors.ink,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 22,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  wordmark: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  subtitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fields: {
    gap: spacing.md,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
});
