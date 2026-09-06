import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ItemContent } from '../itemContent';
import { emptyContent } from '../itemContent';
import Icon from '../icons';
import IdentityWizard from './IdentityWizard';
import type { VaultStackScreenProps } from '../navigation';
import { colors, fonts, spacing } from '../theme';
import { Button, Chip, Field, SecretField } from '../ui';
import * as vault from '../vault';

const TITLES: Record<ItemContent['type'], string> = {
  login: 'Login',
  card: 'Card',
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

type OptionalField = { key: string; label: string; secure?: boolean; keyboardType?: 'default' | 'number-pad' };

/**
 * Design rule 2: fields are asked for by how often they're actually
 * entered, not by schema -- everything else starts as an add-chip. Fields
 * with an existing value (editing a saved item) start already shown.
 */
function useOptionalFields(schema: OptionalField[], content: Record<string, unknown>) {
  const [shown, setShown] = useState<Set<string>>(() => new Set(schema.filter(f => str(content, f.key) !== '').map(f => f.key)));
  const add = (key: string) => setShown(s => new Set(s).add(key));
  return {
    visible: schema.filter(f => shown.has(f.key)),
    remaining: schema.filter(f => !shown.has(f.key)),
    add,
  };
}

function SometimesChips(props: { fields: OptionalField[]; onAdd: (key: string) => void }) {
  if (props.fields.length === 0) return null;
  return (
    <>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>Sometimes</Text>
        <View style={styles.sectionRule} />
      </View>
      <View style={styles.chipRow}>
        {props.fields.map(f => (
          <Chip key={f.key} label={f.label} icon="plus" onPress={() => props.onAdd(f.key)} />
        ))}
      </View>
    </>
  );
}

/**
 * One form for creating and editing login, card, secure note, and
 * authenticator items -- identity is enough of a different shape (a 4-step
 * wizard) that it's its own component, see IdentityWizard.tsx.
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

  const loginOptional = useOptionalFields(
    [
      { key: 'mobile', label: 'Mobile' },
      { key: 'notes', label: 'Notes' },
    ],
    content,
  );
  const cardOptional = useOptionalFields(
    [
      { key: 'pin', label: 'PIN', secure: true, keyboardType: 'number-pad' },
      { key: 'notes', label: 'Notes' },
    ],
    content,
  );
  const totpOptional = useOptionalFields(
    [
      { key: 'algorithm', label: 'Algorithm' },
      { key: 'digits', label: 'Digits', keyboardType: 'number-pad' },
      { key: 'period', label: 'Period' },
      { key: 'notes', label: 'Notes' },
    ],
    content,
  );

  if (itemType === 'identity') {
    return <IdentityWizard route={route} navigation={navigation} />;
  }

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

  const renderOptionalField = (f: OptionalField) =>
    f.secure === true ? (
      <SecretField key={f.key} label={f.label} value={value(f.key)} onChangeText={set(f.key)} />
    ) : (
      <Field key={f.key} label={f.label} value={value(f.key)} onChangeText={set(f.key)} keyboardType={f.keyboardType} />
    );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8}>
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>{params.mode === 'create' ? `New ${TITLES[itemType]}` : `Edit ${TITLES[itemType]}`}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="Name" value={value('name')} onChangeText={set('name')} placeholder={TITLES[itemType]} />

        {itemType === 'login' && (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Every time</Text>
              <View style={styles.sectionRule} />
            </View>
            <Field label="URL" value={value('url')} onChangeText={set('url')} autoCapitalize="none" />
            <Field label="Username" value={value('username')} onChangeText={set('username')} autoCapitalize="none" />
            <SecretField label="Password" value={value('password')} onChangeText={set('password')} />
            <Field label="Email" value={value('email')} onChangeText={set('email')} autoCapitalize="none" />
            {loginOptional.visible.map(renderOptionalField)}
            <SometimesChips fields={loginOptional.remaining} onAdd={loginOptional.add} />
          </>
        )}

        {itemType === 'card' && (
          <>
            <Field label="Cardholder Name" value={value('cardholder')} onChangeText={set('cardholder')} />
            <SecretField label="Card Number" value={value('number')} onChangeText={set('number')} />
            <View style={styles.row}>
              <View style={styles.half}>
                <Field label="Expiry Month" value={value('expiryMonth')} onChangeText={set('expiryMonth')} keyboardType="number-pad" />
              </View>
              <View style={styles.half}>
                <Field label="Expiry Year" value={value('expiryYear')} onChangeText={set('expiryYear')} keyboardType="number-pad" />
              </View>
            </View>
            <SecretField label="CVV" value={value('securityCode')} onChangeText={set('securityCode')} />
            {cardOptional.visible.map(renderOptionalField)}
            <SometimesChips fields={cardOptional.remaining} onAdd={cardOptional.add} />
          </>
        )}

        {itemType === 'totp' && (
          <>
            <Pressable style={styles.qrButton}>
              <Icon name="import" size={26} color={colors.ink} />
              <View style={styles.qrButtonText}>
                <Text style={styles.qrButtonTitle}>Scan QR code</Text>
                <Text style={styles.qrButtonHint}>Not available yet -- enter details manually below.</Text>
              </View>
            </Pressable>
            <Field label="Issuer" value={value('issuer')} onChangeText={set('issuer')} />
            <Field label="Account" value={value('account')} onChangeText={set('account')} autoCapitalize="none" />
            <SecretField label="Secret Key" value={value('secret')} onChangeText={set('secret')} hint="Spaces are ignored." />
            {totpOptional.visible.map(f =>
              f.key === 'digits' || f.key === 'period' ? (
                <Field
                  key={f.key}
                  label={f.label}
                  value={String(num(content, f.key, f.key === 'digits' ? 6 : 30))}
                  onChangeText={set(f.key)}
                  keyboardType="number-pad"
                />
              ) : (
                renderOptionalField(f)
              ),
            )}
            <SometimesChips fields={totpOptional.remaining} onAdd={totpOptional.add} />
          </>
        )}

        {itemType === 'note' && <Field label="Content" value={value('notes')} onChangeText={set('notes')} multiline />}

        {error !== null && <Text style={styles.error}>error: {error}</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Cancel" variant="outline" onPress={() => navigation.goBack()} />
        <Button title={busy ? 'Saving…' : `Save ${TITLES[itemType].toLowerCase()}`} disabled={busy} onPress={save} flex />
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
    gap: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(103, 70, 54, 0.12)',
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitle: {
    fontFamily: fonts.condensedBold,
    fontSize: 24,
    color: colors.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  sectionLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(103, 70, 54, 0.16)',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  qrButton: {
    minHeight: 90,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 18,
  },
  qrButtonText: {
    flex: 1,
    gap: 4,
  },
  qrButtonTitle: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 15,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  qrButtonHint: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    padding: spacing.lg,
    paddingTop: spacing.sm + 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(103, 70, 54, 0.12)',
  },
});
