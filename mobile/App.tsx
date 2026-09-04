/**
 * Vaultiq mobile -- proving-ground shell.
 *
 * Not the vault UI. This screen exists only to exercise the native bridge
 * into pw-crypto-core end to end on a real device (CLAUDE.md §0, phase 4).
 *
 * @format
 */

import { useState } from 'react';
import {
  Button,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import CryptoCore from './src/nativeCryptoCore';

// A fixed, obviously-fake string -- never a real password (CLAUDE.md §2.6).
const TEST_PASSWORD = 'correct horse battery staple';

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [salt, setSalt] = useState<string | null>(null);
  const [strength, setStrength] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSmokeTest = async () => {
    setError(null);
    try {
      const [generatedSalt, estimated] = await Promise.all([
        CryptoCore.generateSalt(),
        CryptoCore.estimateStrength(TEST_PASSWORD),
      ]);
      setSalt(generatedSalt);
      setStrength(`${estimated.level} (${estimated.bits} bits)`);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.content}>
        <Text style={styles.title}>pw-crypto-core FFI smoke test</Text>
        <Button title="Run" onPress={runSmokeTest} />
        {salt !== null && <Text>salt: {salt}</Text>}
        {strength !== null && <Text>test password strength: {strength}</Text>}
        {error !== null && <Text style={styles.error}>error: {error}</Text>}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
  error: {
    color: 'red',
  },
});

export default App;
