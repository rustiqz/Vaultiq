import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ItemContent } from '../itemContent';
import Icon from '../icons';
import ItemAvatar from '../ItemAvatar';
import { copyForAWhile } from '../lib/clipboard';
import { countLogins, countUserItems } from '../lib/itemCount';
import { displayName, text } from '../itemContent';
import LogoMark from '../LogoMark';
import type { VaultStackScreenProps } from '../navigation';
import * as storage from '../storage';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Card, SearchBar } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';

const BROWSE_TILES = [
  { itemType: 'card', label: 'Cards', icon: 'card' },
  { itemType: 'identity', label: 'Identities', icon: 'identity' },
  { itemType: 'note', label: 'Notes', icon: 'note' },
] as const;

const NEW_ITEM_TYPES: { itemType: ItemContent['type']; label: string; hint: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { itemType: 'login', label: 'Login', hint: 'Username, password, URL and TOTP', icon: 'login' },
  { itemType: 'card', label: 'Card', hint: 'Payment card with expiry and CVV', icon: 'card' },
  { itemType: 'identity', label: 'Identity', hint: 'Name, address, phone and documents', icon: 'identity' },
  { itemType: 'note', label: 'Secure note', hint: 'Free text, recovery codes, keys', icon: 'note' },
  { itemType: 'totp', label: 'Authenticator', hint: 'Time-based one-time code', icon: 'totp' },
];

/**
 * A plain custom sheet rather than `Alert.alert`'s buttons: Android caps a
 * native alert at three buttons, which silently drops two of these five
 * types (and Cancel) instead of erroring -- found by testing this on an
 * actual device.
 */
function NewItemSheet(props: { visible: boolean; onClose: () => void; onPick: (itemType: ItemContent['type']) => void }) {
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={props.onClose}>
        <Pressable style={styles.sheetCard}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>New item</Text>
          {NEW_ITEM_TYPES.map(({ itemType, label, hint, icon }) => (
            <Pressable key={itemType} style={styles.sheetRow} onPress={() => props.onPick(itemType)}>
              <View style={styles.sheetRowIcon}>
                <Icon name={icon} size={20} color={colors.ink} />
              </View>
              <View style={styles.sheetRowText}>
                <Text style={styles.sheetRowLabel}>{label}</Text>
                <Text style={styles.sheetRowHint}>{hint}</Text>
              </View>
              <Icon name="chevronRight" size={17} color={colors.ink} />
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type LoginSort = 'recent' | 'az';

export default function VaultHomeScreen({ navigation }: VaultStackScreenProps<'VaultHome'>) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sort, setSort] = useState<LoginSort>('recent');
  const [lastUsed, setLastUsed] = useState<Record<string, number>>({});

  const sync = useCallback(async () => {
    setError(null);
    try {
      const [pulled, usage] = await Promise.all([vault.pullItems(), storage.readLastUsed()]);
      setItems(pulled.filter(item => !item.deleted));
      setLastUsed(usage);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  // Refreshes on every focus, not just mount, so returning here after a
  // create/edit/delete on ItemEdit/ItemDetail shows the current server state
  // rather than a stale in-memory list -- this app has no local item cache
  // to invalidate instead (see vault.ts's pullItems).
  useFocusEffect(
    useCallback(() => {
      sync();
    }, [sync]),
  );

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const openItem = async (item: DecryptedItem) => {
    await storage.recordItemUsed(item.id);
    navigation.navigate('ItemDetail', { item });
  };

  const copyPassword = (item: DecryptedItem) => {
    copyForAWhile(text(item.content, 'password'));
    setCopiedId(item.id);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedId(null), 1600);
  };

  const logins = (items ?? []).filter(item => item.itemType === 'login');
  const visible = logins
    .filter(item => {
      if (query.trim() === '') return true;
      const name = text(item.content, 'name');
      const username = text(item.content, 'username');
      return `${name} ${username}`.toLowerCase().includes(query.trim().toLowerCase());
    })
    .sort((a, b) => {
      if (sort === 'az') return displayName(a.itemType, a.content, a.id).localeCompare(displayName(b.itemType, b.content, b.id));
      return (lastUsed[b.id] ?? 0) - (lastUsed[a.id] ?? 0);
    });

  const isEmptyVault = items !== null && countUserItems(items) === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.appBar}>
        <View style={styles.brandRow}>
          <LogoMark size={26} color={colors.ink} />
          <Text style={styles.brandWordmark}>Vaultiq</Text>
        </View>
        <Pressable style={styles.appBarAction} onPress={() => setPickerVisible(true)} accessibilityRole="button" accessibilityLabel="New item">
          <Icon name="plus" size={21} color={colors.ink} />
        </Pressable>
      </View>
      {items === null ? (
        <View style={styles.loading}>
          <LogoMark size={40} color={colors.ink} />
        </View>
      ) : isEmptyVault ? (
        <EmptyVault onAddFirst={() => setPickerVisible(true)} />
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={visible}
          keyExtractor={item => item.id}
          // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
          ItemSeparatorComponent={() => <View style={styles.rowGap} />}
          ListHeaderComponent={
            <View style={styles.header}>
              <SearchBar value={query} onChangeText={setQuery} placeholder={`Search ${countLogins(items ?? [])} logins`} />
              <View style={styles.browseSection}>
                <Text style={styles.sectionLabel}>Browse</Text>
                <View style={styles.browseGrid}>
                  {BROWSE_TILES.map(tile => (
                    <Pressable
                      key={tile.itemType}
                      style={styles.browseTile}
                      onPress={() => navigation.navigate('TypeList', { itemType: tile.itemType })}
                    >
                      <Icon name={tile.icon} size={20} color={colors.ink} />
                      <Text style={styles.browseTileLabel}>{tile.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {error !== null && <Text style={styles.error}>error: {error}</Text>}
              <View style={styles.loginsHeaderRow}>
                <Text style={styles.sectionLabel}>Logins · {logins.length}</Text>
                <Pressable onPress={() => setSort(s => (s === 'recent' ? 'az' : 'recent'))}>
                  <Text style={styles.sortToggle}>{sort === 'recent' ? 'Recent' : 'A–Z'}</Text>
                </Pressable>
              </View>
              {items !== null && visible.length === 0 && (
                <Text style={styles.emptyState}>{logins.length === 0 ? 'No logins yet.' : 'No matches.'}</Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const name = displayName(item.itemType, item.content, item.id);
            const sub = text(item.content, 'username') || text(item.content, 'url');
            return (
              <Card onPress={() => openItem(item)}>
                <View style={styles.row}>
                  <ItemAvatar itemType={item.itemType} content={item.content} id={item.id} />
                  <View style={styles.rowText}>
                    <View style={styles.rowNameLine}>
                      <Text style={styles.rowName}>{name}</Text>
                      {item.login !== undefined && item.login.reusedBy > 0 && (
                        <Icon name="alertTriangle" size={13} color={colors.amber} />
                      )}
                    </View>
                    {sub !== '' && <Text style={styles.rowSub}>{sub}</Text>}
                  </View>
                  <Pressable
                    style={styles.rowCopy}
                    accessibilityLabel={`Copy password for ${name}`}
                    onPress={event => {
                      event.stopPropagation();
                      copyPassword(item);
                    }}
                  >
                    {copiedId === item.id ? <Text style={styles.rowCopied}>Copied</Text> : <Icon name="copy" size={17} color={colors.ink} />}
                  </Pressable>
                </View>
              </Card>
            );
          }}
        />
      )}
      <NewItemSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onPick={itemType => {
          setPickerVisible(false);
          navigation.navigate('ItemEdit', { mode: 'create', itemType });
        }}
      />
    </SafeAreaView>
  );
}

function EmptyVault(props: { onAddFirst: () => void }) {
  const rows: { icon: Parameters<typeof Icon>[0]['name']; label: string }[] = [
    { icon: 'login', label: 'Logins and passwords' },
    { icon: 'card', label: 'Cards and payment details' },
    { icon: 'totp', label: 'Authenticator codes' },
  ];
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIntro}>
        <Text style={styles.sectionLabel}>Empty vault</Text>
        <Text style={styles.emptyTitle}>Nothing stored{'\n'}here yet</Text>
        <View style={styles.emptyRule} />
        <Text style={styles.emptyBody}>Everything is encrypted on this device before it ever reaches the server.</Text>
      </View>
      <View>
        {rows.map(row => (
          <View key={row.icon} style={styles.emptyRow}>
            <Icon name={row.icon} size={21} color={colors.ink} />
            <Text style={styles.emptyRowLabel}>{row.label}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.emptyPrimary} onPress={props.onAddFirst}>
        <Icon name="plus" size={18} color={colors.onInk} />
        <Text style={styles.emptyPrimaryText}>Add first item</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.screen,
    paddingRight: 12,
    backgroundColor: colors.background,
  },
  appBarAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandWordmark: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 17,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  list: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.screen,
    paddingTop: spacing.xs,
  },
  header: {
    gap: spacing.md,
  },
  browseSection: {
    gap: spacing.sm + 2,
  },
  sectionLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  browseGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  browseTile: {
    flex: 1,
    height: 66,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.16),
    borderRadius: 14,
    paddingHorizontal: 11,
    justifyContent: 'center',
    gap: 8,
  },
  browseTileLabel: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 13.5,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12,
  },
  loginsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  sortToggle: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
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
  rowNameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  rowCopy: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopied: {
    fontFamily: fonts.condensedBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    gap: 26,
    paddingHorizontal: spacing.screen,
    paddingBottom: 40,
  },
  emptyIntro: {
    gap: spacing.sm + 4,
  },
  emptyTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 40,
    lineHeight: 41,
    color: colors.ink,
  },
  emptyRule: {
    height: 1,
    backgroundColor: colors.ink,
    opacity: 0.4,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.ink,
  },
  emptyRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.14),
  },
  emptyRowLabel: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
  },
  emptyPrimary: {
    height: 54,
    borderRadius: 12,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  emptyPrimaryText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 15,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    paddingBottom: 24,
    gap: 2,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: inkAlpha(0.3),
    alignSelf: 'center',
    marginBottom: 8,
  },
  sheetTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 26,
    color: colors.ink,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  sheetRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.1),
  },
  sheetRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowText: {
    flex: 1,
    gap: 2,
  },
  sheetRowLabel: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 15.5,
    color: colors.ink,
  },
  sheetRowHint: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.ink,
  },
});
