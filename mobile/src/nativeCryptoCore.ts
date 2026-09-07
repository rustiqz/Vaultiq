import { NativeModules } from 'react-native';

/**
 * Typed wrapper around the `CryptoCore` native module (see
 * android/app/src/main/java/com/vaultiq/mobile/CryptoCoreModule.kt), which
 * bridges into pw-crypto-core's uniffi bindings.
 *
 * The module holds at most one unwrapped vault key at a time -- nothing
 * derived from a key is ever passed across this boundary as a value, only
 * success/failure and the auth key (which is meant to leave the device).
 */
type Argon2Params = {
  memoryKib: number;
  iterations: number;
  parallelism: number;
};

type WrappedVaultKey = {
  version: number;
  ciphertext: number[];
  nonce: number[];
};

// Ciphertext/nonce are base64 here, matching the server's `sync` wire shape
// exactly (server/src/sync/dto.ts validates them as such) -- unlike
// WrappedVaultKey above, which is number arrays, an untyped field the server
// never validates. Two different wire conventions for two different routes.
type EncryptedItem = {
  id: string;
  itemType: string;
  format: number;
  ciphertext: string;
  nonce: string;
  version: number;
  updatedAt: number;
  deleted: boolean;
};

type ItemHeader = {
  id: string;
  itemType: string;
  version: number;
  updatedAt: number;
  deleted: boolean;
};

type PasswordStrength = {
  bits: number;
  level: string;
};

type CryptoCoreNativeModule = {
  generateSalt(): Promise<string>;
  estimateStrength(password: string): Promise<PasswordStrength>;
  deriveAuthKey(
    password: string,
    saltB64: string,
    memoryKib: number,
    iterations: number,
    parallelism: number,
  ): Promise<string>;
  unlock(
    password: string,
    saltB64: string,
    memoryKib: number,
    iterations: number,
    parallelism: number,
    wrappedVaultKey: WrappedVaultKey,
  ): Promise<void>;
  rewrapVaultKey(
    currentPassword: string,
    currentSaltB64: string,
    currentMemoryKib: number,
    currentIterations: number,
    currentParallelism: number,
    currentWrappedVaultKey: WrappedVaultKey,
    newPassword: string,
    newSaltB64: string,
    newMemoryKib: number,
    newIterations: number,
    newParallelism: number,
  ): Promise<WrappedVaultKey>;
  lock(): Promise<void>;
  isUnlocked(): Promise<boolean>;
  encryptItem(plaintextJson: string, header: ItemHeader): Promise<EncryptedItem>;
  decryptItem(item: EncryptedItem): Promise<string>;
  totpCode(secretB32: string, algorithm: string, digits: number, period: number, unixSeconds: number): Promise<string>;
  totpSecondsRemaining(period: number, unixSeconds: number): Promise<number>;
};

const { CryptoCore } = NativeModules as { CryptoCore: CryptoCoreNativeModule };

export default CryptoCore;
export type { Argon2Params, EncryptedItem, ItemHeader, PasswordStrength, WrappedVaultKey };
