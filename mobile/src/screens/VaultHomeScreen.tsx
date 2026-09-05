import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Icon, { type FeatherName } from '../icons';
import { displayName, text } from '../itemContent';
import type { VaultStackScreenProps } from '../navigation';
import { colors, radii, spacing } from '../theme';
import { Card, Chip } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';

const ITEM_TYPES = ['login', 'card', 'identity', 'note', 'totp'] as const;
const ITEM_TYPE_LABELS: Record<string, string> = {
  login: 'Logins',
  card: 'Cards',
  identity: 'Identities',
  note: 'Secure Notes',
  totp: 'Authenticators',
};
const ITEM_TYPE_ICONS: Record<string, FeatherName> = {
  login: 'key',
  card: 'credit-card',
  identity: 'user',
  note: 'file-text',
  totp: 'shield',
};

export default function VaultHomeScreen({ navigation }: VaultStackScreenProps<'VaultHome'>) {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      setItems(await vault.pullItems());
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  const visible = (items ?? []).filter(item => {
    if (typeFilter !== null && item.itemType !== typeFilter) return false;
    if (query.trim() === '') return true;
    const name = text(item.content, 'name');
    const username = text(item.content, 'username');
    return `${name} ${username}`.toLowerCase().includes(query.trim().toLowerCase());
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
        <View>
          <View style={styles.searchRow}>
            <Icon name="search" size={18} color={colors.muted} />
            <TextInput
              style={styles.search}
              placeholder="Search vault items"
              placeholderTextColor={colors.muted}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <FlatList
            horizontal
            data={[null, ...ITEM_TYPES]}
            keyExtractor={type => type ?? 'all'}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            renderItem={({ item: type }) => (
              <Chip
                label={type === null ? 'All' : ITEM_TYPE_LABELS[type]}
                active={typeFilter === type}
                onPress={() => setTypeFilter(type)}
              />
            )}
          />
          {error !== null && <Text style={styles.error}>error: {error}</Text>}
          {items !== null && visible.length === 0 && (
            <Text style={styles.emptyState}>{items.length === 0 ? 'No items in this vault yet.' : 'No items match.'}</Text>
          )}
        </View>
      }
      renderItem={({ item }) => {
        const name = displayName(item.itemType, item.content, item.id);
        const secondary = text(item.content, 'username') || text(item.content, 'url') || ITEM_TYPE_LABELS[item.itemType];
        return (
          <Card onPress={() => navigation.navigate('ItemDetail', { item })}>
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Icon name={ITEM_TYPE_ICONS[item.itemType] ?? 'file'} size={18} color={colors.heading} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowName}>{name}</Text>
                <Text style={styles.secondary}>{secondary}</Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.muted} />
            </View>
          </Card>
        );
      }}
      refreshing={syncing}
      onRefresh={sync}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    padding: spacing.lg,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.badge,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  search: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    color: colors.text,
  },
  chipRow: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
  },
  emptyState: {
    color: colors.muted,
    textAlign: 'center',
    padding: spacing.lg,
  },
  rowGap: {
    height: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.badge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    color: colors.text,
    fontWeight: '600',
  },
  secondary: {
    color: colors.muted,
    fontSize: 12,
  },
});
