import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import type { ItemContent } from '../itemContent';
import { displayName } from '../itemContent';
import { parseBitwardenJson } from '../lib/bitwardenImport';
import { parseCsv, rowsToItems, type ImportResult } from '../lib/csvImport';
import { findMatch, type DedupeMatch } from '../lib/importDedupe';
import { parseProtonPassJson } from '../lib/protonPassImport';
import type { SettingsStackScreenProps } from '../navigation';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button } from '../ui';
import * as vault from '../vault';

type Row = { item: ItemContent; included: boolean; match: DedupeMatch | null; replace: boolean };
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
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null);

  const choose = async () => {
    setError(null);
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
    }
  };

  const runImport = async () => {
    setStage('importing');
    const errors: string[] = [];
    let imported = 0;
    for (const row of rows) {
      if (!row.included) continue;
      try {
        if (row.match !== null && row.replace) {
          await vault.updateItem(row.match.id, row.match.version, row.item);
        } else {
          await vault.addItem(row.item);
        }
        imported += 1;
      } catch (thrown) {
        errors.push(`${displayName(row.item.type, row.item, String(imported + errors.length))}: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    }
    setResult({ imported, errors });
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
  const summaryParts = [
    `${String(includedCount)} ready to import`,
    skipped > 0 ? `${String(skipped)} skipped (unrecognised type or empty)` : null,
    duplicateCount > 0 ? `${String(duplicateCount)} already in your vault` : null,
  ].filter((part): part is string => part !== null);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>Import</Text>
      </View>

      {stage === 'pick' && (
        <View style={styles.content}>
          <Text style={styles.intro}>
            Pick a CSV export from Chrome, Firefox, LastPass, 1Password, or similar, a Bitwarden JSON export
            (logins, secure notes, cards and identities), or a Proton Pass JSON export (logins and secure notes).
            Anything else in the file is skipped and counted before you confirm.
          </Text>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <Button title="Choose file" onPress={choose} />
        </View>
      )}

      {stage === 'preview' && (
        <>
          <Text style={styles.summary}>{`${summaryParts.join(', ')}.`}</Text>
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
            <Button title={`Import ${String(includedCount)}`} disabled={includedCount === 0} onPress={runImport} />
          </View>
        </>
      )}

      {stage === 'importing' && (
        <View style={styles.content}>
          <Text style={styles.intro}>Importing…</Text>
        </View>
      )}

      {stage === 'done' && result !== null && (
        <View style={styles.content}>
          <Text style={styles.intro}>
            {result.errors.length > 0
              ? `Imported ${String(result.imported)}. ${String(result.errors.length)} failed.`
              : `Imported ${String(result.imported)}.`}
          </Text>
          {result.errors.map(message => (
            <Text key={message} style={styles.error}>
              {message}
            </Text>
          ))}
          <Text style={styles.intro}>Delete the file now that it's imported -- it holds your passwords in plain text.</Text>
          <Button title="Import another file" variant="outline" onPress={() => setStage('pick')} />
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
  summary: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.ink,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
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
