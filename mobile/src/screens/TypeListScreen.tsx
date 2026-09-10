import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import ItemAvatar from '../ItemAvatar';
import { displayName, text } from '../itemContent';
import type { VaultStackScreenProps } from '../navigation';
import * as storage from '../storage';
import { colors, fonts, spacing } from '../theme';
import { Card, SearchBar } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';

const SEARCH_PLURAL: Record<'card' | 'identity' | 'note', string> = { card: 'cards', identity: 'identities', note: 'notes' };

/** Cards, Identities and Secure Notes each get this same list screen -- one Browse tile per type, per the redesign's IA (Vault Home stays Logins-only). */
export default function TypeListScreen({ route, navigation }: VaultStackScreenProps<'TypeList'>) {
  const { itemType } = route.params;
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [query, setQuery] = useState('');

  const sync = useCallback(async () => {
    const [pulled, lastUsed] = await Promise.all([vault.pullItems(), storage.readLastUsed()]);
    const filtered = pulled.filter(item => item.itemType === itemType);
    filtered.sort((a, b) => (lastUsed[b.id] ?? 0) - (lastUsed[a.id] ?? 0));
    setItems(filtered);
  }, [itemType]);

  useFocusEffect(
    useCallback(() => {
      sync();
    }, [sync]),
  );

  const openItem = async (item: DecryptedItem) => {
    await storage.recordItemUsed(item.id);
    navigation.navigate('ItemDetail', { item });
  };

  const visible = (items ?? []).filter(item => {
    if (query.trim() === '') return true;
    const name = text(item.content, 'name');
    return name.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={visible}
      keyExtractor={item => item.id}
      // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
      ItemSeparatorComponent={() => <View style={styles.rowGap} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${SEARCH_PLURAL[itemType]}`} />
          {items !== null && visible.length === 0 && (
            <Text style={styles.emptyState}>{items.length === 0 ? 'Nothing here yet.' : 'No matches.'}</Text>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const name = displayName(item.itemType, item.content, item.id);
        const sub =
          itemType === 'card'
            ? [text(item.content, 'number').slice(-4) && `•••• ${text(item.content, 'number').slice(-4)}`, [text(item.content, 'expiryMonth'), text(item.content, 'expiryYear')].filter(Boolean).join('/')]
                .filter(Boolean)
                .join(' · ')
            : itemType === 'identity'
              ? text(item.content, 'email') || text(item.content, 'city')
              : 'Secure note';
        return (
          <Card onPress={() => openItem(item)}>
            <View style={styles.row}>
              <ItemAvatar itemType={item.itemType} content={item.content} id={item.id} />
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{name}</Text>
                {sub !== '' && <Text style={styles.rowSub}>{sub}</Text>}
              </View>
              <Icon name="chevronRight" size={16} color={colors.ink} />
            </View>
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.xs,
    paddingBottom: spacing.screen,
  },
  header: {
    gap: spacing.md,
    marginBottom: spacing.sm,
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
