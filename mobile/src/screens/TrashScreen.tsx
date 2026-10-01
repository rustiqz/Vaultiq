import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import ItemAvatar from '../ItemAvatar';
import { displayName, text } from '../itemContent';
import type { SettingsStackScreenProps } from '../navigation';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Card, useConfirmDialog } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';

/**
 * Trashed items -- recoverable via `restoreItem`, or permanently erased via
 * `purgeItem` -- the mobile analogue of the extension's Trash screen
 * (`unlockedScreen === "trash"` in extension/src/popup/index.ts). Works for
 * both vault modes: `vault.pullItems()`/`trashItem`/`restoreItem`/
 * `purgeItem` already route through the local-item-store-or-server split
 * internally (see vault.ts's `persist`), so this screen never needs to know
 * which kind of vault it's showing.
 */
export default function TrashScreen({ navigation }: SettingsStackScreenProps<'Trash'>) {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { show, dialog } = useConfirmDialog();

  const sync = useCallback(async () => {
    setError(null);
    try {
      const pulled = await vault.pullItems();
      setItems(pulled.filter(item => item.deleted));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      sync();
    }, [sync]),
  );

  const restore = async (item: DecryptedItem) => {
    setBusyId(item.id);
    try {
      await vault.restoreItem(item.id, item.version, item.itemType, item.content);
      await sync();
    } catch (thrown) {
      show('Could not restore', thrown instanceof Error ? thrown.message : String(thrown), [{ text: 'OK' }]);
    } finally {
      setBusyId(null);
    }
  };

  const purge = (item: DecryptedItem) => {
    show('Delete forever?', 'This permanently erases it. It cannot be recovered.', [
      { text: 'Keep it' },
      {
        text: 'Delete forever',
        destructive: true,
        onPress: async () => {
          setBusyId(item.id);
          try {
            await vault.purgeItem(item.id, item.version, item.itemType);
            await sync();
          } catch (thrown) {
            show('Could not delete', thrown instanceof Error ? thrown.message : String(thrown), [{ text: 'OK' }]);
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.appBarTitle}>Trash</Text>
      </View>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items ?? []}
        keyExtractor={item => item.id}
        // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
        ItemSeparatorComponent={() => <View style={styles.rowGap} />}
        ListEmptyComponent={items !== null ? <Text style={styles.emptyState}>Trash is empty.</Text> : undefined}
        renderItem={({ item }) => {
          const name = displayName(item.itemType, item.content, item.id);
          const sub = text(item.content, 'username') || text(item.content, 'url');
          const busy = busyId === item.id;
          return (
            <Card>
              <View style={styles.row}>
                <ItemAvatar itemType={item.itemType} content={item.content} id={item.id} />
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{name}</Text>
                  {sub !== '' && <Text style={styles.rowSub}>{sub}</Text>}
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable style={styles.actionButton} disabled={busy} onPress={() => restore(item)}>
                  <Text style={styles.actionText}>Restore</Text>
                </Pressable>
                <Pressable style={styles.actionButton} disabled={busy} onPress={() => purge(item)}>
                  <Text style={[styles.actionText, styles.actionTextDanger]}>Delete forever</Text>
                </Pressable>
              </View>
            </Card>
          );
        }}
      />
      {dialog}
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
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.sm,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
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
    gap: spacing.md,
    padding: spacing.md,
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
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.14),
  },
  actionButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: inkAlpha(0.14),
  },
  actionText: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 13,
    color: colors.ink,
  },
  actionTextDanger: {
    color: colors.rust,
  },
});
