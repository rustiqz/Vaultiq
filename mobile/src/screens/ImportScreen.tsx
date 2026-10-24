import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import ListEnd from '../ListEnd';
import { displayName, type ItemContent } from '../itemContent';
import { parseBitwardenJson } from '../lib/bitwardenImport';
import { parseCsv, rowsToItems, type ImportResult } from '../lib/csvImport';
import { findMatch } from '../lib/importDedupe';
import { type ImportOutcome, type ImportProgress, type ImportRow, runImport } from '../lib/importRun';
import { parseProtonPassJson } from '../lib/protonPassImport';
import type { SkippedRow } from '../lib/skippedRow';
import type { DecryptedItem } from '../vault';
import type { SettingsStackScreenProps } from '../navigation';
import { FixSheet, ReviewTabs, SkippedItem, SummaryCard, type ReviewTab } from '../ImportReview';
import { PickArt, ProgressBar, ResultBadge, SpinningDial, StatTile, Steps, clampFraction, stepIndex } from '../ImportVisuals';
import { colors, fonts, inkAlpha, radii, spacing } from '../theme';
import { Button } from '../ui';
import * as vault from '../vault';

type Row = ImportRow;
type Stage = 'pick' | 'preview' | 'importing' | 'done';

/**
 * Tries each recognised JSON export shape before falling back to CSV.
 *
 * A file that looks like JSON (starts with `{`) but matches neither shape
 * throws "not a Proton Pass export" from the second attempt, which the
 * caller already turns into a generic "nothing recognisable" message -- no
 * separate error path needed for an unrecognised JSON export.
 */
function detectAndParse(text: string): ImportResult {
  if (text.trim().startsWith('{')) {
    try {
      return parseBitwardenJson(text);
    } catch {
      // Not a Bitwarden export -- fall through to the other JSON shape.
    }
    return parseProtonPassJson(text);
  }
  return rowsToItems(parseCsv(text));
}

/**
 * Imports logins and secure notes from a CSV export -- Chrome, Firefox,
 * LastPass, 1Password and similar all produce something this recognises
 * (see lib/csvImport.ts for the exact column mapping) -- plus a Bitwarden
 * JSON export (logins, secure notes, cards and identities) or a Proton
 * Pass JSON export (logins and secure notes; see lib/bitwardenImport.ts
 * and lib/protonPassImport.ts for what each does and doesn't map). Parsing
 * happens entirely on-device before anything is encrypted, and each row
 * then goes through `vault.addItem` exactly as if it had been typed into
 * the "New item" form by hand -- `addItem` is already mode-aware, so this
 * screen never needs to know whether the vault is local-only or synced.
 * Rows are matched against `vault.pullItems()` first (lib/importDedupe.ts):
 * a row identical to something already there starts unchecked, and a row
 * that shares the same login/card/identity/etc. but differs is flagged with
 * an option to replace the existing item instead of adding a second one.
 */
export default function ImportScreen({ navigation }: SettingsStackScreenProps<'Import'>) {
  const [stage, setStage] = useState<Stage>('pick');
  const [rows, setRows] = useState<Row[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [existing, setExisting] = useState<DecryptedItem[]>([]);
  const [tab, setTab] = useState<ReviewTab>('ready');
  const [fixing, setFixing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [progress, setProgress] = useState<ImportProgress>({ done: 0, total: 0, current: '' });
  const [reading, setReading] = useState(false);

  const choose = async () => {
    setError(null);
    setReading(true);
    try {
      const [picked] = await pick({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/json'],
      });
      // React Native's fetch can read a content:// (Android) or file:// (iOS)
      // uri directly -- no extra filesystem dependency needed for this.
      const text = await (await fetch(picked.uri)).text();
      const parsed = detectAndParse(text);
      // Rows with something readable in them can still be fixed; a file where
      // nothing could be read at all is not an export this knows.
      const fixable = parsed.skippedRows.some(row => Object.values(row.draft).some(value => value !== ''));
      if (parsed.items.length === 0 && !fixable) {
        setError('Nothing recognisable in that file -- see the note above for what this can read.');
        return;
      }
      const existingItems = await vault.pullItems();
      setRows(
        parsed.items.map(item => {
          const match = findMatch(item, existingItems);
          return { item, match, included: !(match?.identical ?? false), replace: false };
        }),
      );
      setExisting(existingItems);
      setSkippedRows(parsed.skippedRows);
      setTab(parsed.items.length === 0 ? 'skipped' : 'ready');
      setStage('preview');
    } catch (thrown) {
      if (isErrorWithCode(thrown) && thrown.code === errorCodes.OPERATION_CANCELED) return;
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setReading(false);
    }
  };

  const startImport = async () => {
    const total = rows.filter(row => row.included).length;
    setProgress({ done: 0, total, current: '' });
    setStage('importing');
    // A big file would otherwise redraw this screen twice per row; about a
    // hundred updates is plenty for a bar to look smooth.
    const step = Math.max(1, Math.floor(total / 100));
    const result = await runImport(
      rows,
      { add: vault.addItem, update: vault.updateItem },
      update => {
        if (update.done === 0 || update.done === update.total || update.done % step === 0) setProgress(update);
      },
    );
    setOutcome(result);
    setRows([]);
    setSkippedRows([]);
    setStage('done');
  };

  const toggleRow = (index: number) => {
    setRows(current => current.map((row, i) => (i === index ? { ...row, included: !row.included } : row)));
  };

  const toggleReplace = (index: number) => {
    setRows(current => current.map((row, i) => (i === index ? { ...row, replace: !row.replace } : row)));
  };

  // A fixed row joins the list like any parsed one, checked against the vault the same way.
  const addFixed = (item: ItemContent) => {
    if (fixing === null) return;
    const match = findMatch(item, existing);
    setRows(current => [...current, { item, match, included: !(match?.identical ?? false), replace: false }]);
    setSkippedRows(current => {
      const next = current.filter((_, i) => i !== fixing);
      if (next.length === 0) setTab('ready');
      return next;
    });
    setFixing(null);
  };

  const includedCount = rows.filter(row => row.included).length;
  const duplicateCount = rows.filter(row => row.match?.identical ?? false).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>Import</Text>
      </View>

      <Steps current={stepIndex(stage)} />

      {stage === 'pick' && (
        <View style={styles.pick}>
          <PickArt />
          <Text style={styles.heading}>Bring your logins over</Text>
          <Text style={styles.intro}>Pick an export file from your browser or another password manager.</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Supported files</Text>
            <View style={styles.formats}>
              {['CSV', 'Bitwarden JSON', 'Proton Pass JSON'].map(format => (
                <View key={format} style={styles.format}>
                  <Text style={styles.formatText}>{format}</Text>
                </View>
              ))}
            </View>
            <View style={styles.infoRule} />
            <Text style={styles.infoLabel}>What comes in</Text>
            <View style={styles.infoRow}>
              <Icon name="login" size={18} color={colors.ink} />
              <Text style={styles.infoText}>Logins and secure notes</Text>
            </View>
            <View style={styles.infoRow}>
              <Icon name="card" size={18} color={colors.ink} />
              <Text style={styles.infoText}>Cards and identities, from Bitwarden only</Text>
            </View>
            <View style={styles.infoRow}>
              <Icon name="info" size={18} color={colors.ink} />
              <Text style={styles.infoText}>Anything else is skipped, and counted before you confirm</Text>
            </View>
          </View>
          <View style={styles.privacyRow}>
            <Icon name="lock" size={16} color={colors.ink} />
            <Text style={styles.privacyText}>Read on this device and encrypted before it is saved.</Text>
          </View>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <View style={styles.action}>
            <Button title={reading ? 'Reading file…' : 'Choose file'} disabled={reading} onPress={choose} />
          </View>
        </View>
      )}

      {stage === 'preview' && (
        <>
          <FlatList<Row | SkippedRow>
            data={tab === 'ready' ? rows : skippedRows}
            keyExtractor={(_, index) => `${tab}-${String(index)}`}
            ListFooterComponent={
              (tab === 'ready' ? rows.length : skippedRows.length) > 0 ? (
                <ListEnd text={tab === 'ready' ? 'That is every row. Nothing hiding below.' : 'That is every skipped row. Fix them, or leave them be.'} />
              ) : undefined
            }
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.previewHeader}>
                <SummaryCard ready={includedCount} held={duplicateCount} skipped={skippedRows.length} />
                <ReviewTabs tab={tab} onChange={setTab} ready={rows.length} skipped={skippedRows.length} />
                {tab === 'skipped' && (
                  <Text style={styles.fine}>These could not be read as a login or note. Fix one to add it to the import.</Text>
                )}
              </View>
            }
            ListEmptyComponent={<Text style={styles.fine}>{tab === 'ready' ? 'Nothing to import yet.' : 'Nothing skipped.'}</Text>}
            renderItem={({ item: entry, index }) => {
              if ('reason' in entry) return <SkippedItem row={entry} onFix={() => setFixing(index)} />;
              const row = entry;
              return (
                <View>
                  <Pressable style={styles.row} onPress={() => toggleRow(index)}>
                    <Icon name={row.item.type === 'note' ? 'note' : 'login'} size={18} color={colors.ink} />
                    <View style={styles.rowTextGroup}>
                      <Text style={[styles.rowLabel, !row.included && styles.rowLabelExcluded]} numberOfLines={1}>
                        {displayName(row.item.type, row.item, String(index))}
                      </Text>
                      {row.match !== null && (
                        <Text style={styles.rowCaption} numberOfLines={1}>
                          {row.match.identical ? `Already in your vault as "${row.match.label}"` : `Differs from existing "${row.match.label}"`}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.toggleOff, row.included && styles.toggleOn]}>
                      <View style={styles.toggleThumb} />
                    </View>
                  </Pressable>
                  {row.match !== null && !row.match.identical && row.included && (
                    <Pressable style={styles.replaceRow} onPress={() => toggleReplace(index)} hitSlop={8}>
                      <View style={[styles.checkboxOff, row.replace && styles.checkboxOn]} />
                      <Text style={styles.replaceLabel}>Replace the existing entry instead of adding a new one</Text>
                    </Pressable>
                  )}
                </View>
              );
            }}
          />
          <View style={styles.footer}>
            <Button title={`Import ${String(includedCount)}`} disabled={includedCount === 0} onPress={startImport} />
          </View>
          <FixSheet row={fixing === null ? null : (skippedRows[fixing] ?? null)} rowKey={fixing ?? 0} onClose={() => setFixing(null)} onAdd={addFixed} />
        </>
      )}

      {stage === 'importing' && (
        <View style={styles.centre}>
          <SpinningDial />
          <Text style={styles.heading}>{`Importing ${String(progress.done)} of ${String(progress.total)}`}</Text>
          <View style={styles.progress}>
            <ProgressBar fraction={clampFraction(progress.done, progress.total)} label="Import progress" />
          </View>
          <Text style={styles.current} numberOfLines={1}>
            {progress.current}
          </Text>
          <Text style={styles.fine}>Keep the app open until this finishes.</Text>
        </View>
      )}

      {stage === 'done' && outcome !== null && (
        <View style={styles.doneWrap}>
          <ResultBadge ok={outcome.failures.length === 0} />
          <Text style={styles.heading}>
            {outcome.failures.length === 0 ? 'All done' : `Imported, with ${String(outcome.failures.length)} problem${outcome.failures.length === 1 ? '' : 's'}`}
          </Text>
          <View style={styles.tiles}>
            <StatTile value={outcome.added} label="added" />
            <StatTile value={outcome.replaced} label="replaced" />
            <StatTile value={outcome.failures.length} label="failed" tone={outcome.failures.length > 0 ? 'warn' : 'plain'} />
          </View>
          {outcome.failures.length > 0 && (
            <View style={styles.failures}>
              {outcome.failures.map(failure => (
                <Text key={`${failure.name}:${failure.message}`} style={styles.error}>
                  {`${failure.name}: ${failure.message}`}
                </Text>
              ))}
            </View>
          )}
          <View style={styles.callout}>
            <Icon name="alertTriangle" size={18} color={colors.amber} />
            <Text style={styles.calloutText}>Delete the file now. It holds your passwords in plain text.</Text>
          </View>
          <View style={styles.action}>
            <Button title="Done" onPress={() => navigation.goBack()} />
            <Button title="Import another file" variant="outline" onPress={() => setStage('pick')} />
          </View>
        </View>
      )}
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
    borderBottomColor: inkAlpha(0.12),
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitle: {
    fontFamily: fonts.condensedBold,
    fontSize: 22,
    color: colors.ink,
  },
  pick: {
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: spacing.lg * 1.5,
    gap: spacing.md,
  },
  heading: {
    fontFamily: fonts.condensedBold,
    fontSize: 24,
    color: colors.ink,
    textAlign: 'center',
  },
  formats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  format: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: inkAlpha(0.3),
    backgroundColor: colors.card,
  },
  formatText: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  fine: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.ink,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  action: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignSelf: 'stretch',
  },
  progress: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
  },
  current: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    color: colors.ink,
    maxWidth: '80%',
  },
  failures: {
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    gap: 4,
  },
  callout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.amber,
    backgroundColor: colors.card,
  },
  calloutText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
  },
  intro: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  infoCard: {
    alignSelf: 'stretch',
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.14),
    backgroundColor: colors.card,
  },
  infoLabel: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  infoRule: {
    height: 1,
    backgroundColor: inkAlpha(0.12),
    marginVertical: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  privacyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  previewHeader: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowTextGroup: {
    flex: 1,
  },
  rowLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.ink,
  },
  rowLabelExcluded: {
    opacity: 0.4,
  },
  rowCaption: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: inkAlpha(0.6),
  },
  replaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 30,
    paddingBottom: 10,
  },
  checkboxOff: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  checkboxOn: {
    backgroundColor: colors.ink,
  },
  replaceLabel: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.ink,
  },
  toggleOff: {
    width: 40,
    height: 24,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.ink,
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: 2,
  },
  toggleOn: {
    backgroundColor: colors.ink,
    borderWidth: 0,
    alignItems: 'flex-end',
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: colors.background,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.12),
  },
});
