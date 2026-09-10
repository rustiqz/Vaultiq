import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import ItemAvatar from '../ItemAvatar';
import { displayName, text } from '../itemContent';
import Autofill from '../nativeAutofill';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Card, SearchBar } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';

/**
 * A loose, convenience-only match -- not a security boundary (the user can
 * always search/scroll to any saved login regardless). Full public-suffix-
 * list correctness is what the extension's `tldts` dependency is for; not
 * worth pulling into mobile just to pre-sort one picker screen.
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

/**
 * The screen `AutofillActivity` shows in fill mode -- opened from
 * `VaultiqAutofillService`'s generic "Fill with Vaultiq" placeholder.
 * Reuses the exact same `vault.pullItems()` every other list screen uses;
 * there's nothing autofill-specific about *finding* the login, only about
 * where the chosen one's values go afterward (`Autofill.completeFill`).
 */
export default function AutofillFillScreen(props: { domain: string }) {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    vault
      .pullItems()
      .then(pulled => {
        const logins = pulled.filter(item => item.itemType === 'login');
        logins.sort((a, b) => {
          const aMatch = matchesDomain(text(a.content, 'url'), props.domain);
          const bMatch = matchesDomain(text(b.content, 'url'), props.domain);
          if (aMatch === bMatch) return 0;
          return aMatch ? -1 : 1;
        });
        setItems(logins);
      })
      .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown)));
  }, [props.domain]);

  const visible = (items ?? []).filter(item => {
    if (query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return (
      displayName(item.itemType, item.content, item.id).toLowerCase().includes(needle) ||
      text(item.content, 'username').toLowerCase().includes(needle) ||
      text(item.content, 'url').toLowerCase().includes(needle)
    );
  });

  const choose = (item: DecryptedItem) => {
    Autofill.completeFill(text(item.content, 'username'), text(item.content, 'password'));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => Autofill.cancelFill()} hitSlop={8}>
          <Icon name="close" size={20} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>Fill with Vaultiq</Text>
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={visible}
        keyExtractor={item => item.id}
        // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        ListHeaderComponent={
          <View style={styles.header}>
            {props.domain !== '' && <Text style={styles.domainHint}>For {props.domain}</Text>}
            <SearchBar value={query} onChangeText={setQuery} placeholder="Search logins" />
            {error !== null && <Text style={styles.error}>error: {error}</Text>}
            {items !== null && visible.length === 0 && (
              <Text style={styles.emptyState}>{items.length === 0 ? 'No saved logins yet.' : 'No matches.'}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <Card onPress={() => choose(item)}>
            <View style={styles.row}>
              <ItemAvatar itemType={item.itemType} content={item.content} id={item.id} />
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{displayName(item.itemType, item.content, item.id)}</Text>
                {text(item.content, 'username') !== '' && <Text style={styles.rowSub}>{text(item.content, 'username')}</Text>}
              </View>
              <Icon name="chevronRight" size={16} color={colors.ink} />
            </View>
          </Card>
        )}
      />
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.screen,
  },
  header: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  domainHint: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 5,
    padding: 13,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowName: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  rowSub: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink,
  },
});
