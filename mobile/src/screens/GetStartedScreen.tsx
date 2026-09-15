import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LogoMark from '../LogoMark';
import { colors, fonts, spacing } from '../theme';
import { Button } from '../ui';

/**
 * The first choice on a device with no vault yet -- no app here is
 * privileged as "the first device" the way the extension used to be by
 * accident of build order. Every client offers the same two entry points;
 * see MULTI-TENANCY.md's "symmetric client enrollment."
 */
export default function GetStartedScreen(props: { onJoin: () => void; onCreate: () => void }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <LogoMark variant="primary" size={72} color={colors.ink} stateColor={colors.sage} />
        <Text style={styles.title}>Vaultiq</Text>
        <Text style={styles.body}>Zero-knowledge, on your terms. Join a vault someone else invited you to, or start your own.</Text>
      </View>
      <View style={styles.footer}>
        <Button title="I have an invite" onPress={props.onJoin} />
        <Button title="Create a new vault" variant="outline" onPress={props.onCreate} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 34,
    color: colors.ink,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14.5,
    lineHeight: 22,
    color: colors.ink,
    textAlign: 'center',
    maxWidth: 320,
  },
  footer: {
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
});
