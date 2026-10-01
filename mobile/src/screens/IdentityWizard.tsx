import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { emptyContent, type IdentityContent } from '../itemContent';
import Icon from '../icons';
import type { VaultStackScreenProps } from '../navigation';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button, Chip, Field } from '../ui';
import * as vault from '../vault';
import { useHardwareBack } from '../useHardwareBack';

type Step = 0 | 1 | 2 | 3;
const STEP_LABELS = ['Name', 'Contact', 'Address', 'Review'] as const;

function str(content: Record<string, unknown>, key: string): string {
  const value = content[key];
  return typeof value === 'string' ? value : '';
}

type FieldSpec = { key: string; label: string; keyboardType?: 'default' | 'number-pad' };

function useOptional(schema: FieldSpec[], content: Record<string, unknown>) {
  const [shown, setShown] = useState<Set<string>>(() => new Set(schema.filter(f => str(content, f.key) !== '').map(f => f.key)));
  return {
    visible: schema.filter(f => shown.has(f.key)),
    remaining: schema.filter(f => !shown.has(f.key)),
    add: (key: string) => setShown(s => new Set(s).add(key)),
  };
}

/**
 * Identity gets its own wizard rather than fitting the flat every-time/
 * sometimes form ItemEditScreen uses for everything else -- fifteen
 * possible fields, never more than a few at once (redesign 6i/6ab/6ac).
 * Three data steps (Name, Contact, Address) plus a fourth "step" that's
 * the review screen itself, per-group summary with a jump-back Edit pill.
 */
export default function IdentityWizard({ route, navigation }: VaultStackScreenProps<'ItemEdit'>) {
  const { params } = route;
  // ItemEditScreen only delegates here for identity items, so params.item's
  // content (in edit mode) is always an IdentityContent already.
  const initial: Record<string, unknown> = params.mode === 'create' ? emptyContent('identity') : params.item.content;

  const [step, setStep] = useState<Step>(0);
  const [content, setContent] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useHardwareBack(() => {
    if (step > 0) { setStep(s => (s - 1) as Step); return true; }
    return false;
  });

  const set = (key: string) => (value: string) => setContent(current => ({ ...current, [key]: value }));
  const value = (key: string) => str(content, key);

  const nameOptional = useOptional(
    [
      { key: 'company', label: 'Company' },
      { key: 'dateOfBirth', label: 'Date of birth' },
    ],
    content,
  );
  const contactOptional = useOptional([{ key: 'nationalId', label: 'National ID' }], content);
  const addressOptional = useOptional(
    [
      { key: 'street2', label: 'Street 2' },
      { key: 'state', label: 'State' },
    ],
    content,
  );

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const finalContent = { ...content, type: 'identity' } as IdentityContent;
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

  const reviewGroups: { title: string; step: Step; rows: { label: string; value: string }[] }[] = [
    {
      title: 'Name',
      step: 0,
      rows: [
        { label: 'First name', value: value('firstName') },
        { label: 'Last name', value: value('lastName') },
        { label: 'Label', value: value('name') },
        { label: 'Company', value: value('company') },
        { label: 'Date of birth', value: value('dateOfBirth') },
      ].filter(r => r.value !== ''),
    },
    {
      title: 'Contact',
      step: 1,
      rows: [
        { label: 'Email', value: value('email') },
        { label: 'Phone', value: value('phone') },
        { label: 'National ID', value: value('nationalId') },
      ].filter(r => r.value !== ''),
    },
    {
      title: 'Address',
      step: 2,
      rows: [
        { label: 'Street', value: value('street') },
        { label: 'Street 2', value: value('street2') },
        { label: 'City', value: value('city') },
        { label: 'State', value: value('state') },
        { label: 'Postcode', value: value('postalCode') },
        { label: 'Country', value: value('country') },
      ].filter(r => r.value !== ''),
    },
  ];
  const totalFields = reviewGroups.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => (step === 0 ? navigation.goBack() : setStep(s => (s - 1) as Step))}
          hitSlop={8}
        >
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>{params.mode === 'create' ? 'New Identity' : 'Edit Identity'}</Text>
      </View>

      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          {[0, 1, 2, 3].map(index => (
            <View key={index} style={[styles.progressSegment, index <= step && styles.progressSegmentFilled]} />
          ))}
        </View>
        <View style={styles.progressLabelRow}>
          <Text style={styles.stepLabel}>
            Step {step + 1} of 4 · {STEP_LABELS[step]}
          </Text>
          {step < 3 && <Text style={styles.stepLabel}>{totalFields} fields</Text>}
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 0 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Who is this identity for?</Text>
            <Text style={styles.stepSubtitle}>Only the name is required. You can leave every later step empty.</Text>
            <View style={styles.row}>
              <View style={styles.half}>
                <Field label="First name" value={value('firstName')} onChangeText={set('firstName')} />
              </View>
              <View style={styles.half}>
                <Field label="Last name" value={value('lastName')} onChangeText={set('lastName')} />
              </View>
            </View>
            <Field
              label="Label"
              value={value('name')}
              onChangeText={set('name')}
              optional
              hint="Distinguishes this from a work identity in lists."
            />
            {nameOptional.visible.map(f => (
              <Field key={f.key} label={f.label} value={value(f.key)} onChangeText={set(f.key)} />
            ))}
            <SometimesChips fields={nameOptional.remaining} onAdd={nameOptional.add} />
          </View>
        )}

        {step === 1 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>How do we reach them?</Text>
            <Text style={styles.stepSubtitle}>Used when a form asks for contact details.</Text>
            <Field label="Email" value={value('email')} onChangeText={set('email')} autoCapitalize="none" />
            <Field label="Phone" value={value('phone')} onChangeText={set('phone')} autoCapitalize="none" />
            {contactOptional.visible.map(f => (
              <Field key={f.key} label={f.label} value={value(f.key)} onChangeText={set(f.key)} />
            ))}
            <SometimesChips fields={contactOptional.remaining} onAdd={contactOptional.add} />
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Where do they live?</Text>
            <Text style={styles.stepSubtitle}>Used when a checkout form asks for a billing address.</Text>
            <Field label="Street address" value={value('street')} onChangeText={set('street')} />
            <View style={styles.row}>
              <View style={styles.half}>
                <Field label="City" value={value('city')} onChangeText={set('city')} />
              </View>
              <View style={styles.thirdWide}>
                <Field label="Postcode" value={value('postalCode')} onChangeText={set('postalCode')} autoCapitalize="none" />
              </View>
            </View>
            <Field label="Country" value={value('country')} onChangeText={set('country')} />
            {addressOptional.visible.map(f => (
              <Field key={f.key} label={f.label} value={value(f.key)} onChangeText={set(f.key)} />
            ))}
            <SometimesChips fields={addressOptional.remaining} onAdd={addressOptional.add} />
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepBody}>
            <Text style={styles.stepTitle}>Check before saving</Text>
            {reviewGroups.map(group => (
              <View key={group.title} style={styles.reviewGroup}>
                <View style={styles.reviewGroupHeader}>
                  <Text style={styles.sectionLabel}>{group.title}</Text>
                  <View style={styles.sectionRule} />
                  <Pressable style={styles.editPill} onPress={() => setStep(group.step)}>
                    <Text style={styles.editPillText}>Edit</Text>
                  </Pressable>
                </View>
                {group.rows.length === 0 ? (
                  <Text style={styles.reviewEmpty}>Nothing entered.</Text>
                ) : (
                  <View style={styles.reviewCard}>
                    {group.rows.map((row, index) => (
                      <View key={row.label} style={[styles.reviewRow, index > 0 && styles.reviewRowDivider]}>
                        <Text style={styles.reviewLabel}>{row.label}</Text>
                        <Text style={styles.reviewValue}>{row.value}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
            {error !== null && <Text style={styles.error}>error: {error}</Text>}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.row}>
          {step > 0 && <Button title="Back" variant="outline" onPress={() => setStep(s => (s - 1) as Step)} />}
          {step < 3 && <Button title="Continue" onPress={() => setStep(s => (s + 1) as Step)} flex />}
          {step === 3 && <Button title={busy ? 'Saving…' : 'Save identity'} disabled={busy} onPress={save} flex />}
        </View>
        {step < 3 && (
          <Pressable onPress={() => setStep(3)}>
            <Text style={styles.skipText}>Skip to review</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function SometimesChips(props: { fields: FieldSpec[]; onAdd: (key: string) => void }) {
  if (props.fields.length === 0) return null;
  return (
    <View style={styles.chipRow}>
      {props.fields.map(f => (
        <Chip key={f.key} label={f.label} icon="plus" onPress={() => props.onAdd(f.key)} />
      ))}
    </View>
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
  progressWrap: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.md,
    gap: 9,
  },
  progressTrack: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    backgroundColor: inkAlpha(0.18),
  },
  progressSegmentFilled: {
    backgroundColor: colors.ink,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  stepLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.screen,
    paddingTop: 0,
  },
  stepBody: {
    gap: spacing.md,
  },
  stepTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 28,
    lineHeight: 31,
    color: colors.ink,
  },
  stepSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.ink,
    marginTop: -6,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  thirdWide: {
    width: 138,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
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
    backgroundColor: inkAlpha(0.16),
  },
  reviewGroup: {
    gap: spacing.sm + 1,
  },
  reviewGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  editPill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPillText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  reviewEmpty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
  },
  reviewCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.14),
    borderRadius: 14,
    overflow: 'hidden',
  },
  reviewRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  reviewRowDivider: {
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.08),
  },
  reviewLabel: {
    width: 104,
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  reviewValue: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlign: 'right',
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm + 2,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.12),
    gap: spacing.sm + 2,
  },
  skipText: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.ink,
    textAlign: 'center',
  },
});
