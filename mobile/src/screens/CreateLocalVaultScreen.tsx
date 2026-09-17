import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../icons';
import { colors, fonts, inkAlpha, spacing } from '../theme';
import { Button, SecretField } from '../ui';

/**
 * Creates a vault that stays on this device only -- no server, no
 * registration token, nothing to scan. A single step rather than
 * CreateVaultScreen's three: there is exactly one thing to choose, the
 * master password, since a local vault has no server-facing fields to
 * collect at all. See vault.ts's `createLocalVaultAndUnlock`.
 */
export default function CreateLocalVaultScreen(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
  /** Back out to the join-or-create choice. */
  onExit?: () => void;
}) {
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={() => props.onExit?.()} hitSlop={8}>
          <Icon name="chevronLeft" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Use without a server</Text>
        <Text style={styles.body}>
          This vault lives on this device only -- nothing is ever uploaded anywhere, and it won't appear on any
          other device. Choose a master password: never stored or sent anywhere, and if it's lost this vault
          cannot be recovered.
        </Text>
        <SecretField label="Master password" value={password} onChangeText={setPassword} />
        {props.error !== null && <Text style={styles.error}>{props.error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={props.busy ? 'Creating…' : 'Create local vault'}
          disabled={props.busy || password === ''}
          onPress={() => props.onSubmit(password)}
        />
      </View>
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
  },
  back: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 30,
    lineHeight: 33,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: colors.ink,
  },
  error: {
    fontFamily: fonts.body,
    color: colors.rust,
    fontSize: 12.5,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: inkAlpha(0.12),
    gap: spacing.sm + 2,
  },
});
