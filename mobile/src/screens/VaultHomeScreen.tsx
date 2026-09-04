import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { VaultStackScreenProps } from '../navigation';
import { colors, radii, spacing } from '../theme';
import { Chip } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';
import { displayName, text } from '../itemContent';

const ITEM_TYPES = ['login', 'card', 'identity', 'note', 'totp'] as const;
const ITEM_TYPE_LABELS: Record<string, string> = {
  login: 'Logins',
  card: 'Cards',
  identity: 'Identities',
  note: 'Notes',
  totp: 'Authenticators',
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
      ListHeaderComponent={
        <View>
          <TextInput
            style={styles.search}
            placeholder="Search vault items"
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
          />
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
        const secondary = text(item.content, 'username') || text(item.content, 'url') || item.itemType;
        return (
          <Pressable style={styles.listRow} onPress={() => navigation.navigate('ItemDetail', { item })}>
            <View style={styles.rowIcon}>
              <Text style={styles.rowIconText}>{item.itemType.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{name}</Text>
              <Text style={styles.secondary}>{secondary}</Text>
            </View>
          </Pressable>
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
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    padding: spacing.sm + 4,
    backgroundColor: colors.surface,
    color: colors.text,
    marginBottom: spacing.sm,
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
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: {
    color: colors.onPrimary,
    fontWeight: '700',
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
