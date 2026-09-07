import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import Icon from '../icons';
import LogoMark from '../LogoMark';
import { colors, fonts, spacing } from '../theme';
import { Button, SecretField } from '../ui';

export default function UnlockScreen(props: {
  busy: boolean;
  error: string | null;
  biometricEnabled: boolean;
  onSubmit: (password: string) => void;
  onBiometric: () => void;
}) {
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      {props.error !== null && (
        <View style={styles.errorBanner}>
          <Icon name="alertTriangle" size={16} color={colors.rust} />
          <Text style={styles.errorBannerText}>Unable to unlock vault</Text>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <LogoMark variant="detailed" size={72} color={colors.ink} tickColor={colors.sage} />
          <View style={styles.brandText}>
            <Text style={styles.brandTitle}>Vaultiq</Text>
            <Text style={styles.brandSubtitle}>Locked</Text>
          </View>
        </View>
        <SecretField label="Master password" value={password} onChangeText={setPassword} />
        <Button title={props.busy ? 'Unlocking…' : 'Unlock'} disabled={props.busy} onPress={() => props.onSubmit(password)} />
        {props.biometricEnabled && (
          <Button title="Use fingerprint" variant="outline" disabled={props.busy} onPress={props.onBiometric} />
        )}
        <View style={styles.infoBox}>
          <Icon name="info" size={17} color={colors.ink} />
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
    gap: spacing.sm + 6,
  },
  brand: {
    alignItems: 'center',
    gap: 18,
    marginBottom: spacing.md,
  },
  brandText: {
    alignItems: 'center',
    gap: 6,
  },
  brandTitle: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 22,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  brandSubtitle: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.rust,
  },
  errorBannerText: {
    fontFamily: fonts.semiCondensedSemiBold,
    color: colors.rust,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 3,
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.sage,
    padding: 14,
    marginTop: spacing.sm,
  },
  infoBoxText: {
    flex: 1,
    fontFamily: fonts.body,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 19,
  },
});
