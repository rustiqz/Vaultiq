import Clipboard from '@react-native-clipboard/clipboard';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import Icon from '../icons';
import { text } from '../itemContent';
import { colors, fonts, spacing } from '../theme';
import { SearchBar, showComingSoon, useConfirmDialog } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';
import { useTotpCode } from '../useTotpCode';

const RING_SIZE = 42;
const RING_RADIUS = 17;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Bottom-tab quick access to every authenticator code, live, grouped by
 * account -- a user is typically hunting for one specific account's code,
 * not browsing a flat list (design backlog / redesign v2 6u). Tapping a row
 * copies its current code.
 */
export default function AuthenticatorScreen() {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { show, dialog } = useConfirmDialog();

  const sync = useCallback(async () => {
    setError(null);
    try {
      setItems((await vault.pullItems()).filter(item => item.itemType === 'totp'));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      sync();
    }, [sync]),
  );

  const visible = (items ?? []).filter(item => {
    if (query.trim() === '') return true;
    const q = query.trim().toLowerCase();
    return text(item.content, 'account').toLowerCase().includes(q) || text(item.content, 'issuer').toLowerCase().includes(q);
  });

  const groups = new Map<string, DecryptedItem[]>();
  for (const item of visible) {
    const key = text(item.content, 'account') || text(item.content, 'issuer') || text(item.content, 'name') || 'Other';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.appBar}>
        <Text style={styles.title}>Codes</Text>
        <Pressable onPress={() => showComingSoon(show, 'Adding an authenticator from here')} hitSlop={8}>
          <Icon name="plus" size={21} color={colors.ink} />
        </Pressable>
      </View>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={[...groups.entries()]}
        keyExtractor={([account]) => account}
        // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
        ItemSeparatorComponent={() => <View style={styles.groupGap} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <SearchBar value={query} onChangeText={setQuery} placeholder="Search by account or issuer" />
            {error !== null && <Text style={styles.error}>error: {error}</Text>}
            {items !== null && visible.length === 0 && (
              <Text style={styles.emptyState}>{items.length === 0 ? 'No authenticator codes in this vault yet.' : 'No matches.'}</Text>
            )}
          </View>
        }
        renderItem={({ item: [account, codes] }) => (
          <View style={styles.group}>
            <View style={styles.groupHeaderRow}>
              <Text style={styles.groupLabel}>{account}</Text>
              <View style={styles.groupRule} />
            </View>
            <View style={styles.groupRows}>
              {codes.map(item => (
                <AuthenticatorRow key={item.id} item={item} />
              ))}
            </View>
          </View>
        )}
      />
      {dialog}
    </SafeAreaView>
  );
}

function AuthenticatorRow(props: { item: DecryptedItem }) {
  const c = props.item.content;
  const period = typeof c.period === 'number' ? c.period : 30;
  const { code, secondsLeft } = useTotpCode(
    text(c, 'secret'),
    text(c, 'algorithm') || 'SHA1',
    typeof c.digits === 'number' ? c.digits : 6,
    period,
  );
  const issuer = text(c, 'issuer') || text(c, 'name') || props.item.id;
  const progress = secondsLeft === null ? 0 : secondsLeft / period;

  return (
    <Pressable style={styles.row} onPress={code === null ? undefined : () => Clipboard.setString(code)}>
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 42 42">
          <Circle cx={21} cy={21} r={RING_RADIUS} fill="none" stroke="rgba(103, 70, 54, 0.16)" strokeWidth={4} />
          <Circle
            cx={21}
            cy={21}
            r={RING_RADIUS}
            fill="none"
            stroke={colors.sage}
            strokeWidth={9}
            strokeDasharray={`${RING_CIRCUMFERENCE * progress} ${RING_CIRCUMFERENCE}`}
            transform="rotate(-90 21 21)"
          />
        </Svg>
        <Text style={styles.ringSeconds}>{secondsLeft ?? ''}</Text>
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowIssuer}>{issuer}</Text>
        <Text style={styles.rowCode}>{code ?? '······'}</Text>
      </View>
      <Icon name="copy" size={18} color={colors.ink} />
    </Pressable>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontFamily: fonts.condensedBold,
    fontSize: 24,
    color: colors.ink,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
  },
  header: {
    gap: spacing.md,
    marginBottom: spacing.md,
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
  groupGap: {
    height: spacing.lg,
  },
  group: {
    gap: spacing.sm + 2,
  },
  groupHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  groupLabel: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 12.5,
    color: colors.ink,
  },
  groupRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(103, 70, 54, 0.16)',
  },
  groupRows: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 82,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(103, 70, 54, 0.14)',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringSeconds: {
    position: 'absolute',
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowIssuer: {
    fontFamily: fonts.semiCondensedSemiBold,
    fontSize: 14,
    color: colors.ink,
  },
  rowCode: {
    fontFamily: fonts.mono,
    fontSize: 22,
    letterSpacing: 2,
    color: colors.ink,
  },
});
