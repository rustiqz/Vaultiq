import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Animated, Easing, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import EmptyState from '../EmptyState';
import Icon from '../icons';
import { copyForAWhile } from '../lib/clipboard';
import { text } from '../itemContent';
import type { RootTabParamList } from '../navigation';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { SearchBar, useConfirmDialog } from '../ui';
import useRefreshOnRemoteChange from '../useRefreshOnRemoteChange';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';
import { useTotpCode } from '../useTotpCode';

const RING_SIZE = 50;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** Seconds left at which the ring turns amber -- "expiring soon", not an error. */
const EXPIRING_SECONDS = 7;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Countdown ring that drains smoothly across each second instead of
 * stepping once a second, with the whole seconds inside. Amber (icon/border
 * use only, design rule 7) in the last few seconds; the number stays ink.
 */
function TimerRing(props: { secondsLeft: number | null; period: number }) {
  const progress = useRef(new Animated.Value(0)).current;
  const previous = useRef<number | null>(null);
  const { secondsLeft, period } = props;

  useEffect(() => {
    if (secondsLeft === null) return;
    // A new period starts with the ring full again; don't animate backwards.
    if (previous.current === null || secondsLeft > previous.current) progress.setValue(secondsLeft / period);
    previous.current = secondsLeft;
    // JS-driven: SVG props are not supported by the native animation driver.
    Animated.timing(progress, {
      toValue: Math.max(secondsLeft - 1, 0) / period,
      duration: 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [secondsLeft, period, progress]);

  const expiring = secondsLeft !== null && secondsLeft <= EXPIRING_SECONDS;
  const dashOffset = progress.interpolate({ inputRange: [0, 1], outputRange: [RING_CIRCUMFERENCE, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.ringWrap}>
      <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke={inkAlpha(0.14)} strokeWidth={RING_STROKE} />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={expiring ? colors.amber : colors.sage}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      <Text style={styles.ringSeconds}>{secondsLeft ?? ''}</Text>
    </View>
  );
}

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
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList, 'Codes'>>();
  const { show, dialog } = useConfirmDialog();

  const sync = useCallback(async () => {
    setError(null);
    try {
      setItems((await vault.pullItems()).filter(item => !item.deleted && item.itemType === 'totp'));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      sync();
    }, [sync]),
  );

  // Another device's changes arriving while this screen is in front.
  useRefreshOnRemoteChange(sync);

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
        <Pressable
          style={styles.appBarAction}
          accessibilityRole="button"
          accessibilityLabel="Add authenticator"
          onPress={() => navigation.navigate('Vault', { screen: 'ItemEdit', params: { mode: 'create', itemType: 'totp' } })}
        >
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
            {items !== null && visible.length === 0 &&
              (items.length === 0 ? (
                <EmptyState
                  icon="totp"
                  title="No codes yet"
                  hint="Add an authenticator account to see its live one-time code here."
                  actionLabel="Add authenticator"
                  onAction={() => navigation.navigate('Vault', { screen: 'ItemEdit', params: { mode: 'create', itemType: 'totp' } })}
                />
              ) : (
                <EmptyState
                  icon="search"
                  title="No matches"
                  hint={`Nothing matches “${query.trim()}”.`}
                  actionLabel="Clear search"
                  onAction={() => setQuery('')}
                />
              ))}
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
                <AuthenticatorRow
                  key={item.id}
                  item={item}
                  onOpen={() => navigation.navigate('Vault', { screen: 'ItemDetail', params: { item } })}
                  onDelete={() =>
                    show('Move to Trash?', 'You can restore it from Trash in Settings.', [
                      { text: 'Cancel' },
                      {
                        text: 'Move to Trash',
                        destructive: true,
                        onPress: () => {
                          vault
                            .trashItem(item.id, item.version, item.itemType, item.content)
                            .then(sync)
                            .catch(thrown => setError(thrown instanceof Error ? thrown.message : String(thrown)));
                        },
                      },
                    ])
                  }
                />
              ))}
            </View>
          </View>
        )}
      />
      {dialog}
    </SafeAreaView>
  );
}

function AuthenticatorRow(props: { item: DecryptedItem; onOpen: () => void; onDelete: () => void }) {
  const c = props.item.content;
  const period = typeof c.period === 'number' ? c.period : 30;
  const { code, secondsLeft, failed } = useTotpCode(
    text(c, 'secret'),
    text(c, 'algorithm') || 'SHA1',
    typeof c.digits === 'number' ? c.digits : 6,
    period,
  );
  const issuer = text(c, 'issuer') || text(c, 'name') || props.item.id;
  const grouped = code === null ? '······' : `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;

  return (
    // Tap copies a live code; a row with no code (bad secret, still loading)
    // opens the item instead so it can be inspected or deleted. Long-press
    // moves any row to Trash without opening it.
    <Pressable
      style={styles.row}
      onPress={code === null ? props.onOpen : () => copyForAWhile(code)}
      onLongPress={props.onDelete}
    >
      <TimerRing secondsLeft={secondsLeft} period={period} />
      <View style={styles.rowText}>
        <Text style={styles.rowIssuer}>{issuer}</Text>
        {failed ? (
          <Text style={styles.rowError}>Invalid secret</Text>
        ) : (
          <Text style={styles.rowCode}>{grouped}</Text>
        )}
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
    paddingLeft: spacing.screen,
    paddingRight: 12,
  },
  appBarAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.screen,
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
    backgroundColor: inkAlpha(0.16),
  },
  groupRows: {
    gap: spacing.sm,
  },
  row: {
    minHeight: 88,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: inkAlpha(0.14),
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
    fontSize: 13,
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
  rowError: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.rust,
  },
  rowCode: {
    fontFamily: fonts.mono,
    fontSize: 26,
    letterSpacing: 3,
    color: colors.ink,
  },
});
