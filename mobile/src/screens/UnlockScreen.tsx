import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import Icon from '../icons';
import { colors, radii, spacing } from '../theme';
import { Field, PillButton } from '../ui';

export default function UnlockScreen(props: { busy: boolean; error: string | null; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      {props.error !== null && (
        <View style={styles.errorBanner}>
          <Icon name="alert-triangle" size={16} color={colors.danger} />
          <Text style={styles.errorBannerText}>Unable to unlock vault</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Icon name="shield" size={28} color={colors.onPrimary} />
          </View>
          <Text style={styles.brandTitle}>Vaultiq</Text>
        </View>
        <Field label="Master Password" placeholder="Enter master password" secure value={password} onChangeText={setPassword} />
        <PillButton title={props.busy ? 'Unlocking…' : 'Unlock'} disabled={props.busy} onPress={() => props.onSubmit(password)} />
        <View style={styles.infoBox}>
          <Icon name="info" size={16} color={colors.muted} />
          <Text style={styles.infoBoxText}>Zero-knowledge vault — no password recovery is possible.</Text>
        </View>
      </ScrollView>
      <Text style={styles.link}>Learn more about zero-knowledge security</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brandMark: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerTint,
    padding: spacing.md,
  },
  errorBannerText: {
    color: colors.danger,
    fontWeight: '600',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.badge,
    borderRadius: radii.input,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
  },
  infoBoxText: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
  },
  link: {
    color: colors.primary,
    textDecorationLine: 'underline',
    textAlign: 'center',
    fontSize: 13,
    paddingBottom: spacing.lg,
  },
});
