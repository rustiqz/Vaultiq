import { NativeModules } from 'react-native';

/**
 * Typed wrapper around the `CryptoCore` native module (see
 * android/app/src/main/java/com/vaultiq/mobile/CryptoCoreModule.kt), which
 * bridges into pw-crypto-core's uniffi bindings.
 *
 * This is a proving-ground surface, not the real vault API: it exists to
 * confirm the Rust -> JNI -> Kotlin -> JS chain works on a device, not to be
 * the shape the eventual unlock flow calls.
 */
type PasswordStrength = {
  bits: number;
  level: string;
};

type CryptoCoreNativeModule = {
  generateSalt(): Promise<string>;
  estimateStrength(password: string): Promise<PasswordStrength>;
};

const { CryptoCore } = NativeModules as { CryptoCore: CryptoCoreNativeModule };

export default CryptoCore;
export type { PasswordStrength };
