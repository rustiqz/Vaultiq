import { NativeModules } from 'react-native';

/**
 * Typed wrapper around the `Biometric` native module (see
 * android/app/src/main/java/com/vaultiq/mobile/BiometricModule.kt).
 * Encrypts/decrypts the cached master password under a Keystore key gated
 * by biometric auth -- it never touches the vault key or pw-crypto-core at
 * all, deliberately a separate, simpler mechanism (CLAUDE.md §0).
 */
type SealedPassword = {
  ciphertextB64: string;
  ivB64: string;
};

type BiometricNativeModule = {
  isAvailable(): Promise<boolean>;
  enable(password: string): Promise<SealedPassword>;
  unlock(ciphertextB64: string, ivB64: string): Promise<string>;
  disable(): Promise<void>;
};

const { Biometric } = NativeModules as { Biometric: BiometricNativeModule };

export default Biometric;
export type { SealedPassword };
