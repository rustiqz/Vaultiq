import Clipboard from '@react-native-clipboard/clipboard';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Icon from '../icons';
import { text } from '../itemContent';
import { colors, spacing } from '../theme';
import { Card } from '../ui';
import * as vault from '../vault';
import type { DecryptedItem } from '../vault';
import { useTotpCode } from '../useTotpCode';

/**
 * Bottom-tab quick access to every authenticator code, live, without
 * drilling into Item Detail per code -- the same role a dedicated
 * authenticator app plays. Tapping a row copies its current code.
 */
export default function AuthenticatorScreen() {
  const [items, setItems] = useState<DecryptedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const sync = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      setItems((await vault.pullItems()).filter(item => item.itemType === 'totp'));
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [sync]);

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={items ?? []}
      keyExtractor={item => item.id}
      // eslint-disable-next-line react/no-unstable-nested-components -- FlatList's own documented separator shape.
      ItemSeparatorComponent={() => <View style={styles.rowGap} />}
      ListHeaderComponent={
        <>
          {error !== null && <Text style={styles.error}>error: {error}</Text>}
          {items !== null && items.length === 0 && <Text style={styles.emptyState}>No authenticator codes in this vault yet.</Text>}
        </>
      }
      renderItem={({ item }) => <AuthenticatorRow item={item} />}
      refreshing={syncing}
      onRefresh={sync}
    />
  );
}

function AuthenticatorRow(props: { item: DecryptedItem }) {
  const c = props.item.content;
  const { code, secondsLeft } = useTotpCode(
    text(c, 'secret'),
    text(c, 'algorithm') || 'SHA1',
    typeof c.digits === 'number' ? c.digits : 6,
    typeof c.period === 'number' ? c.period : 30,
  );
  const name = text(c, 'name') || text(c, 'issuer') || text(c, 'account') || props.item.id;

  return (
    <Card onPress={code === null ? undefined : () => Clipboard.setString(code)}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Icon name="shield" size={18} color={colors.heading} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{name}</Text>
          <Text style={styles.secondary}>{text(c, 'account')}</Text>
        </View>
        <View style={styles.codeBlock}>
          <Text style={styles.code}>{code ?? '······'}</Text>
          {secondsLeft !== null && <Text style={styles.secondsLeft}>{secondsLeft}s</Text>}
        </View>
      </View>
    </Card>
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
  codeBlock: {
    alignItems: 'flex-end',
  },
  code: {
    color: colors.heading,
    fontWeight: '700',
    fontSize: 18,
    letterSpacing: 2,
  },
  secondsLeft: {
    color: colors.muted,
    fontSize: 11,
  },
});
