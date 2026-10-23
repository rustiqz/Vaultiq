import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import { displayName } from '../itemContent';
import { parseBitwardenJson } from '../lib/bitwardenImport';
import { parseCsv, rowsToItems, type ImportResult } from '../lib/csvImport';
import { findMatch } from '../lib/importDedupe';
import { type ImportOutcome, type ImportProgress, type ImportRow, runImport } from '../lib/importRun';
import { parseProtonPassJson } from '../lib/protonPassImport';
import type { SettingsStackScreenProps } from '../navigation';
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
  const [skipped, setSkipped] = useState(0);
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
      if (parsed.items.length === 0) {
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
      setSkipped(parsed.skipped);
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
    setSkipped(0);
    setStage('done');
  };

  const toggleRow = (index: number) => {
    setRows(current => current.map((row, i) => (i === index ? { ...row, included: !row.included } : row)));
  };

  const toggleReplace = (index: number) => {
    setRows(current => current.map((row, i) => (i === index ? { ...row, replace: !row.replace } : row)));
  };

  const includedCount = rows.filter(row => row.included).length;
  const duplicateCount = rows.filter(row => row.match?.identical ?? false).length;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
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
          <Text style={styles.intro}>
            Choose an export from another password manager or your browser. It is read on this device and encrypted
            before it is saved.
          </Text>
          <View style={styles.formats}>
            {['CSV', 'Bitwarden JSON', 'Proton Pass JSON'].map(format => (
              <View key={format} style={styles.format}>
                <Text style={styles.formatText}>{format}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.fine}>
            Logins and secure notes from any of them. Cards and identities too from Bitwarden. Anything else in the
            file is skipped, and counted before you confirm.
          </Text>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <View style={styles.action}>
            <Button title={reading ? 'Reading file…' : 'Choose file'} disabled={reading} onPress={choose} />
          </View>
        </View>
      )}

      {stage === 'preview' && (
        <>
          <View style={styles.tiles}>
            <StatTile value={includedCount} label="ready to import" />
            <StatTile value={duplicateCount} label="already in your vault" />
            <StatTile value={skipped} label="skipped" tone={skipped > 0 ? 'warn' : 'plain'} />
          </View>
          {skipped > 0 && <Text style={styles.fine}>Skipped rows were an unrecognised type, or empty.</Text>}
          <FlatList
            data={rows}
            keyExtractor={(_, index) => String(index)}
            contentContainerStyle={styles.list}
            renderItem={({ item: row, index }) => (
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
            )}
          />
          <View style={styles.footer}>
            <Button title={`Import ${String(includedCount)}`} disabled={includedCount === 0} onPress={startImport} />
          </View>
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
    justifyContent: 'center',
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
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  list: {
    paddingHorizontal: spacing.lg,
    gap: 1,
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
