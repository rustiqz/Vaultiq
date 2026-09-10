import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Autofill from '../nativeAutofill';
import { colors, fonts, spacing } from '../theme';
import { Button, DetailField, Field, SecretField } from '../ui';
import * as vault from '../vault';

/**
 * The screen `AutofillActivity` shows in save mode -- opened from
 * `VaultiqAutofillService.onSaveRequest` after Android's own "Save to
 * Vaultiq?" system prompt was accepted. Just confirms and calls the
 * existing `vault.addItem`; nothing here is autofill-specific once the
 * values are in hand.
 */
export default function AutofillSaveScreen(props: { domain: string; username: string; password: string }) {
  const [name, setName] = useState(props.domain);
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Text style={styles.appBarTitle}>Save to Vaultiq</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Vaultiq noticed a login for {props.domain || 'this site'}.</Text>
        <Field label="Name" value={name} onChangeText={setName} placeholder={props.domain} />
        <DetailField label="Username" value={props.username} />
        <SecretField label="Password" value={props.password} />
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Discard" variant="outline" disabled={busy} onPress={() => Autofill.discardSave()} />
        <Button title={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={save} flex />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
  },
  appBarTitle: {
    fontFamily: fonts.condensedBold,
    fontSize: 22,
    color: colors.ink,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  intro: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    padding: spacing.lg,
    paddingTop: spacing.sm + 4,
  },
});
