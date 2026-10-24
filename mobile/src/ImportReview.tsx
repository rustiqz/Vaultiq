import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from './icons';
import type { ItemContent } from './itemContent';
import type { SkippedRow } from './lib/skippedRow';
import { colors, fonts, inkAlpha, radii, spacing } from './theme';
import { Button, Field, SecretField } from './ui';
import { clampFraction } from './ImportVisuals';

/** A count with a word beside it, rather than a word squeezed under a number. */
function SummaryRow(props: { count: number; label: string; swatch: 'ready' | 'held' | 'skipped' }) {
  return (
    <View style={styles.summaryRow}>
      <View style={[styles.swatch, props.swatch === 'ready' && styles.swatchReady, props.swatch === 'skipped' && styles.swatchSkipped]} />
      <Text style={styles.summaryLabel}>{props.label}</Text>
      <Text style={styles.summaryCount}>{String(props.count)}</Text>
    </View>
  );
}

/**
 * What the file held, at a glance: one bar split three ways, then one line per
 * share. The bar is a picture of the lines, never the only way to read them.
 */
export function SummaryCard(props: { ready: number; held: number; skipped: number }) {
  const total = props.ready + props.held + props.skipped;
  const share = (count: number) => ({ flex: clampFraction(count, total) });
  return (
    <View style={styles.summary} accessible accessibilityLabel={`${String(props.ready)} ready, ${String(props.held)} already in your vault, ${String(props.skipped)} skipped`}>
      <Text style={styles.summaryTitle}>{`${String(total)} ${total === 1 ? 'row' : 'rows'} in this file`}</Text>
      <View style={styles.bar}>
        {props.ready > 0 && <View style={[styles.barPart, styles.barReady, share(props.ready)]} />}
        {props.held > 0 && <View style={[styles.barPart, styles.barHeld, share(props.held)]} />}
        {props.skipped > 0 && <View style={[styles.barPart, styles.barSkipped, share(props.skipped)]} />}
      </View>
      <SummaryRow count={props.ready} label="Ready to import" swatch="ready" />
      <SummaryRow count={props.held} label="Already in your vault" swatch="held" />
      <SummaryRow count={props.skipped} label="Skipped" swatch="skipped" />
    </View>
  );
}

export type ReviewTab = 'ready' | 'skipped';

/** Two tabs, with the second only when there is something in it. */
export function ReviewTabs(props: { tab: ReviewTab; onChange: (tab: ReviewTab) => void; ready: number; skipped: number }) {
  if (props.skipped === 0) return null;
  const tabs: { key: ReviewTab; label: string; count: number }[] = [
    { key: 'ready', label: 'To import', count: props.ready },
    { key: 'skipped', label: 'Skipped', count: props.skipped },
  ];
  return (
    <View style={styles.tabs}>
      {tabs.map(tab => (
        <Pressable
          key={tab.key}
          style={[styles.tab, props.tab === tab.key && styles.tabOn]}
          onPress={() => props.onChange(tab.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: props.tab === tab.key }}
        >
          <Text style={[styles.tabText, props.tab === tab.key && styles.tabTextOn]}>{`${tab.label} · ${String(tab.count)}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** One skipped row: what it was, why it was left out, and the way back in. */
export function SkippedItem(props: { row: SkippedRow; onFix: () => void }) {
  return (
    <View style={styles.skippedRow}>
      <Icon name="alertTriangle" size={18} color={colors.amber} />
      <View style={styles.skippedText}>
        <Text style={styles.skippedLabel} numberOfLines={1}>
          {props.row.label}
        </Text>
        <Text style={styles.skippedReason} numberOfLines={2}>
          {props.row.reason}
        </Text>
      </View>
      <Pressable style={styles.fixPill} onPress={props.onFix} accessibilityRole="button" accessibilityLabel={`Fix ${props.row.label}`}>
        <Text style={styles.fixText}>Fix</Text>
      </Pressable>
    </View>
  );
}

type Kind = 'login' | 'note';

/** The content a fixed row would import as, or null while it still has nothing to hold. */
export function draftToItem(kind: Kind, draft: SkippedRow['draft']): ItemContent | null {
  const trimmed = {
    name: draft.name.trim(),
    username: draft.username.trim(),
    password: draft.password,
    url: draft.url.trim(),
    notes: draft.notes.trim(),
  };
  if (kind === 'note') {
    if (trimmed.name === '' && trimmed.notes === '') return null;
    return {
      type: 'note',
      ...(trimmed.name !== '' && { name: trimmed.name }),
      ...(trimmed.notes !== '' && { notes: trimmed.notes }),
    };
  }
  if (trimmed.username === '' && trimmed.password === '') return null;
  return {
    type: 'login',
    ...(trimmed.name !== '' && { name: trimmed.name }),
    ...(trimmed.username !== '' && { username: trimmed.username }),
    ...(trimmed.password !== '' && { password: trimmed.password }),
    ...(trimmed.url !== '' && { url: trimmed.url }),
    ...(trimmed.notes !== '' && { notes: trimmed.notes }),
  };
}

/**
 * A bottom sheet for correcting a skipped row. It starts from whatever the
 * importer could read, and offers "Add" only once the result would be a real
 * login or note -- the same bar the importers themselves hold.
 */
export function FixSheet(props: { row: SkippedRow | null; rowKey: number; onClose: () => void; onAdd: (item: ItemContent) => void }) {
  return (
    <Modal visible={props.row !== null} transparent animationType="slide" onRequestClose={props.onClose} statusBarTranslucent>
      {props.row !== null && <FixForm key={props.rowKey} row={props.row} onClose={props.onClose} onAdd={props.onAdd} />}
    </Modal>
  );
}

function FixForm(props: { row: SkippedRow; onClose: () => void; onAdd: (item: ItemContent) => void }) {
  const [kind, setKind] = useState<Kind>(props.row.draft.username === '' && props.row.draft.password === '' && props.row.draft.notes !== '' ? 'note' : 'login');
  const [draft, setDraft] = useState(props.row.draft);
  const set = (key: keyof SkippedRow['draft']) => (value: string) => setDraft(current => ({ ...current, [key]: value }));
  const item = draftToItem(kind, draft);

  return (
    <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.scrim} onPress={props.onClose} accessibilityLabel="Close" />
      <SafeAreaView style={styles.sheet} edges={['bottom']}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Fix this row</Text>
          <Pressable onPress={props.onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name="close" size={22} color={colors.ink} />
          </Pressable>
        </View>
        <View style={styles.reasonBox}>
          <Icon name="info" size={16} color={colors.ink} />
          <Text style={styles.reasonText}>{`Skipped: ${props.row.reason}`}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          <View style={styles.kindRow}>
            {(['login', 'note'] as const).map(option => (
              <Pressable key={option} style={[styles.kind, kind === option && styles.kindOn]} onPress={() => setKind(option)} accessibilityRole="tab" accessibilityState={{ selected: kind === option }}>
                <Icon name={option} size={16} color={kind === option ? colors.onInk : colors.ink} />
                <Text style={[styles.kindText, kind === option && styles.kindTextOn]}>{option === 'login' ? 'Login' : 'Secure note'}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Name" value={draft.name} onChangeText={set('name')} optional />
          {kind === 'login' && (
            <>
              <Field label="Username" value={draft.username} onChangeText={set('username')} autoCapitalize="none" optional />
              <SecretField label="Password" value={draft.password} onChangeText={set('password')} />
              <Field label="Website" value={draft.url} onChangeText={set('url')} autoCapitalize="none" optional />
            </>
          )}
          <Field label="Notes" value={draft.notes} onChangeText={set('notes')} multiline optional />
          {item === null && (
            <Text style={styles.needs}>
              {kind === 'login' ? 'Add a username or a password to keep this as a login.' : 'Add a name or some text to keep this as a note.'}
            </Text>
          )}
        </ScrollView>
        <View style={styles.sheetActions}>
          <Button title="Add to import" disabled={item === null} onPress={() => item !== null && props.onAdd(item)} />
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  summary: {
    padding: spacing.md,
    gap: spacing.sm + 2,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.14),
    backgroundColor: colors.card,
  },
  summaryTitle: { fontFamily: fonts.condensedBold, fontSize: 20, color: colors.ink },
  bar: { height: 10, flexDirection: 'row', borderRadius: 5, overflow: 'hidden', backgroundColor: inkAlpha(0.12), gap: 2 },
  barPart: { height: 10 },
  barReady: { backgroundColor: colors.ink },
  barHeld: { backgroundColor: inkAlpha(0.35) },
  barSkipped: { backgroundColor: colors.amber },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swatch: { width: 10, height: 10, borderRadius: 5, backgroundColor: inkAlpha(0.35) },
  swatchReady: { backgroundColor: colors.ink },
  swatchSkipped: { backgroundColor: colors.amber },
  summaryLabel: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  summaryCount: { fontFamily: fonts.condensedBold, fontSize: 18, color: colors.ink },
  tabs: {
    flexDirection: 'row',
    marginTop: spacing.md,
    padding: 3,
    borderRadius: radii.pill,
    backgroundColor: inkAlpha(0.1),
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radii.pill },
  tabOn: { backgroundColor: colors.ink },
  tabText: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 14, color: colors.ink },
  tabTextOn: { color: colors.onInk },
  skippedRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: inkAlpha(0.12),
  },
  skippedText: { flex: 1 },
  skippedLabel: { fontFamily: fonts.body, fontSize: 14.5, color: colors.ink },
  skippedReason: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: inkAlpha(0.6) },
  fixPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1.5, borderColor: colors.ink },
  fixText: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 13, color: colors.ink },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderTopWidth: 3,
    borderTopColor: colors.ink,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, paddingBottom: spacing.sm },
  sheetTitle: { fontFamily: fonts.condensedBold, fontSize: 22, color: colors.ink },
  reasonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    padding: spacing.sm + 2,
    borderRadius: radii.input,
    backgroundColor: inkAlpha(0.08),
  },
  reasonText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  sheetBody: { padding: spacing.lg, gap: spacing.sm },
  kindRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },
  kind: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radii.input,
    borderWidth: 1.5,
    borderColor: inkAlpha(0.3),
    backgroundColor: colors.card,
  },
  kindOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  kindText: { fontFamily: fonts.semiCondensedSemiBold, fontSize: 14, color: colors.ink },
  kindTextOn: { color: colors.onInk },
  needs: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink },
  sheetActions: { padding: spacing.lg, paddingTop: spacing.sm },
});
