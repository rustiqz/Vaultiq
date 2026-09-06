import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import type { ItemContent } from '../itemContent';
import { emptyContent } from '../itemContent';
import type { VaultStackScreenProps } from '../navigation';
import { colors, spacing } from '../theme';
import { Field, SecretField, Button } from '../ui';
import * as vault from '../vault';

const TITLES: Record<ItemContent['type'], string> = {
  login: 'Login',
  card: 'Payment Card',
  identity: 'Identity',
  note: 'Secure Note',
  totp: 'Authenticator',
};

/** Reads a string field out of the free-form working copy, defaulting to "". */
function str(content: Record<string, unknown>, key: string): string {
  const value = content[key];
  return typeof value === 'string' ? value : '';
}

/** Reads a number field, falling back when absent or not yet a valid number. */
function num(content: Record<string, unknown>, key: string, fallback: number): number {
  const value = content[key];
  if (typeof value === 'number') return value;
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * One form for both creating and editing every item type. Fields mirror
 * ItemDetailScreen's -- every field the type's schema carries (itemContent.ts),
 * not a curated subset, matching how that screen shows them.
 */
export default function ItemEditScreen({ route, navigation }: VaultStackScreenProps<'ItemEdit'>) {
  const { params } = route;
  const itemType = params.mode === 'create' ? params.itemType : (params.item.content.type as ItemContent['type']);
  const initial: Record<string, unknown> = params.mode === 'create' ? emptyContent(itemType) : params.item.content;

  const [content, setContent] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: string) => (value: string) => setContent(current => ({ ...current, [key]: value }));
  const value = (key: string) => str(content, key);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const finalContent = { ...content, type: itemType } as ItemContent;
      if (itemType === 'totp') {
        (finalContent as { digits: number }).digits = num(content, 'digits', 6);
        (finalContent as { period: number }).period = num(content, 'period', 30);
      }

      if (params.mode === 'create') {
        await vault.addItem(finalContent);
      } else {
        await vault.updateItem(params.item.id, params.item.version, finalContent);
      }
      navigation.navigate('VaultHome');
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Field label="Name" value={value('name')} onChangeText={set('name')} placeholder={TITLES[itemType]} />

      {itemType === 'login' && (
        <>
          <Field label="URL" value={value('url')} onChangeText={set('url')} autoCapitalize="none" />
          <Field label="Username" value={value('username')} onChangeText={set('username')} autoCapitalize="none" />
          <SecretField label="Password" value={value('password')} onChangeText={set('password')} />
          <Field label="Email" value={value('email')} onChangeText={set('email')} autoCapitalize="none" />
          <Field label="Mobile" value={value('mobile')} onChangeText={set('mobile')} autoCapitalize="none" />
        </>
      )}

      {itemType === 'card' && (
        <>
          <Field label="Cardholder Name" value={value('cardholder')} onChangeText={set('cardholder')} />
          <SecretField label="Card Number" value={value('number')} onChangeText={set('number')} />
          <Field label="Expiry Month" value={value('expiryMonth')} onChangeText={set('expiryMonth')} keyboardType="number-pad" />
          <Field label="Expiry Year" value={value('expiryYear')} onChangeText={set('expiryYear')} keyboardType="number-pad" />
          <SecretField label="CVV" value={value('securityCode')} onChangeText={set('securityCode')} />
          <SecretField label="PIN" value={value('pin')} onChangeText={set('pin')} />
        </>
      )}

      {itemType === 'identity' && (
        <>
          <Field label="First Name" value={value('firstName')} onChangeText={set('firstName')} />
          <Field label="Last Name" value={value('lastName')} onChangeText={set('lastName')} />
          <Field label="Email" value={value('email')} onChangeText={set('email')} autoCapitalize="none" />
          <Field label="Phone" value={value('phone')} onChangeText={set('phone')} autoCapitalize="none" />
          <Field label="Street" value={value('street')} onChangeText={set('street')} />
          <Field label="Street 2" value={value('street2')} onChangeText={set('street2')} />
          <Field label="City" value={value('city')} onChangeText={set('city')} />
          <Field label="State" value={value('state')} onChangeText={set('state')} />
          <Field label="Postal Code" value={value('postalCode')} onChangeText={set('postalCode')} autoCapitalize="none" />
          <Field label="Country" value={value('country')} onChangeText={set('country')} />
          <Field label="Company" value={value('company')} onChangeText={set('company')} />
          <Field label="Date of Birth" value={value('dateOfBirth')} onChangeText={set('dateOfBirth')} />
          <SecretField label="National ID" value={value('nationalId')} onChangeText={set('nationalId')} />
        </>
      )}

      {itemType === 'totp' && (
        <>
          <Field label="Issuer" value={value('issuer')} onChangeText={set('issuer')} />
          <Field label="Account" value={value('account')} onChangeText={set('account')} autoCapitalize="none" />
          <SecretField label="Secret" value={value('secret')} onChangeText={set('secret')} />
          <Field label="Algorithm" value={value('algorithm') || 'SHA1'} onChangeText={set('algorithm')} autoCapitalize="none" />
          <Field label="Digits" value={String(num(content, 'digits', 6))} onChangeText={set('digits')} keyboardType="number-pad" />
          <Field label="Period (seconds)" value={String(num(content, 'period', 30))} onChangeText={set('period')} keyboardType="number-pad" />
        </>
      )}

      <Field
        label={itemType === 'note' ? 'Secure Note Content' : 'Notes'}
        value={value('notes')}
        onChangeText={set('notes')}
        multiline
      />

      {error !== null && <Text style={styles.error}>error: {error}</Text>}
      <Button title={busy ? 'Saving…' : 'Save'} disabled={busy} onPress={save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  error: {
    color: colors.rust,
    fontSize: 12,
  },
});
