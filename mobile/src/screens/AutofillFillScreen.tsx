import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import ItemAvatar from '../ItemAvatar';
import LogoMark from '../LogoMark';
import { displayName, text } from '../itemContent';
import Autofill from '../nativeAutofill';
import { colors, fonts, inkAlpha, radii, spacing } from '../theme';
import { Button, Field, SearchBar, SecretField } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';

/**
 * A loose, convenience-only match -- not a security boundary (the user can
 * always search to any saved login regardless, and the caller banner above
 * the list is the real signal to check). Full public-suffix-list
 * correctness is what the extension's `tldts` dependency is for; not worth
 * pulling into mobile just to pre-sort one picker.
 */
function normalizedHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
}

function registrableDomain(host: string): string {
  const labels = host.split('.');
  return labels.slice(-2).join('.');
}

function matchesDomain(itemUrl: string, domain: string): boolean {
  if (itemUrl === '' || domain === '') return false;
  return registrableDomain(normalizedHost(itemUrl)) === registrableDomain(normalizedHost(domain));
}

const MAX_DIRECT_MATCHES = 3;

type Mode = 'matches' | 'search' | 'create';

/**
 * The sheet `AutofillActivity` shows in fill mode (mockup 6aa) -- a bottom
 * sheet over the dimmed third-party form (the scrim/translucency comes from
 * AutofillActivity's own window theme; this screen only ever renders its own
 * transparent root + the sheet), not a full-screen picker. Reuses the exact
 * same `vault.pullItems()` every other list screen uses -- there's nothing
 * autofill-specific about *finding* the login, only about where the chosen
 * one's values go afterward (`Autofill.completeFill`).
 */
export default function AutofillFillScreen(props: { domain: string; caller: string; callerVerified: boolean }) {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('matches');
  const [query, setQuery] = useState('');
  const [createName, setCreateName] = useState(props.domain);
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const load = () => {
    vault
      .pullItems()
      .then(pulled => {
        const logins = pulled.filter(item => !item.deleted && item.itemType === 'login');
        logins.sort((a, b) => {
          const aMatch = matchesDomain(text(a.content, 'url'), props.domain);
          const bMatch = matchesDomain(text(b.content, 'url'), props.domain);
          if (aMatch === bMatch) return 0;
          return aMatch ? -1 : 1;
        });
        setItems(logins);
      })
      .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown)));
  };

  useEffect(load, [props.domain]);

  const choose = (item: DecryptedItem) => {
    Autofill.completeFill(text(item.content, 'username'), text(item.content, 'password'));
  };

  const directMatches = (items ?? []).slice(0, MAX_DIRECT_MATCHES);

  const searchResults = (items ?? []).filter(item => {
    if (query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return (
      displayName(item.itemType, item.content, item.id).toLowerCase().includes(needle) ||
      text(item.content, 'username').toLowerCase().includes(needle) ||
      text(item.content, 'url').toLowerCase().includes(needle)
    );
  });

  const createLogin = async () => {
    setError(null);
    setCreateBusy(true);
    try {
      await vault.addItem({ type: 'login', name: createName.trim() || props.domain, username: createUsername, password: createPassword, url: props.domain });
      // Already have the plaintext in hand -- no need to re-pull and pick it
      // back out of the vault, just complete the fill with it directly.
      Autofill.completeFill(createUsername, createPassword);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setCreateBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Pressable style={styles.scrim} onPress={() => Autofill.cancelFill()} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <LogoMark variant="compact" size={28} color={colors.ink} />
          <View style={styles.headerText}>
            <Text style={styles.wordmark}>Vaultiq</Text>
            {mode === 'matches' && (
              <View style={styles.subtitleRow}>
                {!props.callerVerified && <Icon name="alertTriangle" size={12} color={colors.amber} />}
                <Text style={styles.subtitle} numberOfLines={1}>
                  {props.callerVerified
                    ? `${directMatches.length} match${directMatches.length === 1 ? '' : 'es'} for ${props.caller}`
                    : `Not a verified website — ${props.caller}`}
                </Text>
              </View>
            )}
            {mode === 'search' && <Text style={styles.subtitle}>Search your vault</Text>}
            {mode === 'create' && <Text style={styles.subtitle}>Save a new login</Text>}
          </View>
          <Pressable style={styles.closeButton} onPress={() => Autofill.cancelFill()} hitSlop={8}>
            <Icon name="close" size={18} color={colors.ink} />
          </Pressable>
        </View>

        {error !== null && <Text style={styles.error}>{error}</Text>}

        {mode === 'matches' && (
          <>
            {items !== null && directMatches.length === 0 && <Text style={styles.emptyState}>No saved logins yet.</Text>}
            {directMatches.map(item => (
              <MatchRow key={item.id} item={item} onFill={() => choose(item)} />
            ))}
            <View style={styles.actionsRow}>
              <Pressable style={styles.actionButton} onPress={() => setMode('search')}>
                <Icon name="search" size={16} color={colors.ink} strokeWidth={1.8} />
                <Text style={styles.actionButtonText}>Search vault</Text>
              </Pressable>
              <Pressable style={styles.actionButton} onPress={() => setMode('create')}>
                <Icon name="plus" size={16} color={colors.ink} strokeWidth={1.8} />
                <Text style={styles.actionButtonText}>Save new</Text>
              </Pressable>
            </View>
          </>
        )}

        {mode === 'search' && (
          <View style={styles.searchArea}>
            <SearchBar value={query} onChangeText={setQuery} placeholder="Search logins" />
            <FlatList
              data={searchResults}
              keyExtractor={item => item.id}
              keyboardShouldPersistTaps="handled"
              // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
              ItemSeparatorComponent={() => <View style={styles.rowGap} />}
              ListEmptyComponent={<Text style={styles.emptyState}>No matches.</Text>}
              renderItem={({ item }) => <MatchRow item={item} onFill={() => choose(item)} />}
            />
          </View>
        )}

        {mode === 'create' && (
          <View style={styles.createArea}>
            <Field label="Name" value={createName} onChangeText={setCreateName} placeholder={props.domain} />
            <Field label="Username" value={createUsername} onChangeText={setCreateUsername} autoCapitalize="none" />
            <SecretField label="Password" value={createPassword} onChangeText={setCreatePassword} />
            <View style={styles.createButtons}>
              <Button title="Cancel" variant="outline" onPress={() => setMode('matches')} disabled={createBusy} />
              <Button
                title={createBusy ? 'Saving…' : 'Save & fill'}
                disabled={createBusy || createUsername === '' || createPassword === ''}
                onPress={createLogin}
                flex
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function MatchRow(props: { item: DecryptedItem; onFill: () => void }) {
  return (
    <View style={styles.row}>
      <ItemAvatar itemType={props.item.itemType} content={props.item.content} id={props.item.id} size={38} />
      <View style={styles.rowText}>
        <Text style={styles.rowName} numberOfLines={1}>
          {displayName(props.item.itemType, props.item.content, props.item.id)}
        </Text>
        {text(props.item.content, 'username') !== '' && (
          <Text style={styles.rowSub} numberOfLines={1}>
            {text(props.item.content, 'username')}
          </Text>
        )}
      </View>
      <Pressable style={styles.fillButton} onPress={props.onFill}>
        <Text style={styles.fillButtonText}>Fill</Text>
      </Pressable>
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
    maxHeight: '82%',
    backgroundColor: colors.background,
    borderTopWidth: 3,
    borderTopColor: colors.ink,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 22,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 6,
    paddingBottom: 12,
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
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
    paddingHorizontal: 6,
  },
  emptyState: {
    fontFamily: fonts.body,
    color: colors.ink,
    textAlign: 'center',
    padding: spacing.lg,
  },
  rowGap: {
    height: spacing.sm,
  },
  row: {
    minHeight: 68,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.16),
    borderRadius: radii.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingLeft: 13,
    paddingRight: 10,
    marginBottom: spacing.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 14.5,
    color: colors.ink,
  },
  rowSub: {
    fontFamily: fonts.mono,
    fontSize: 11.5,
    color: colors.ink,
  },
  fillButton: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: radii.button,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fillButtonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radii.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
  },
  actionButtonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  searchArea: {
    gap: spacing.md,
  },
  createArea: {
    gap: spacing.md,
  },
  createButtons: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
});
