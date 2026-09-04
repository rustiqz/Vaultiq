import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';
import { Field, PillButton } from '../ui';

export default function UnlockScreen(props: { busy: boolean; error: string | null; onSubmit: (password: string) => void }) {
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {props.error !== null && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>⚠ Unable to unlock vault</Text>
          </View>
        )}
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>V</Text>
          </View>
          <Text style={styles.brandTitle}>Vaultiq</Text>
        </View>
        <Field label="Master Password" secure value={password} onChangeText={setPassword} />
        <PillButton title={props.busy ? 'Unlocking…' : 'Unlock'} disabled={props.busy} onPress={() => props.onSubmit(password)} />
        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>Zero-knowledge vault — no password recovery is possible.</Text>
        </View>
      </ScrollView>
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
  brandMarkText: {
    color: colors.onPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.heading,
  },
  errorBanner: {
    backgroundColor: '#F6D9CE',
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: {
    color: colors.danger,
    fontWeight: '600',
  },
  infoBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
  },
  infoBoxText: {
    color: colors.muted,
    fontSize: 12,
  },
});
