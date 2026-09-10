import { NativeModules } from 'react-native';

/**
 * Typed wrapper around the `Autofill` native module (see
 * android/app/src/main/java/com/vaultiq/mobile/AutofillModule.kt). Never
 * touches the vault key or `pw-crypto-core` -- this only ever finishes
 * whatever `AutofillActivity` screen is currently open, the same way
 * `nativeBiometric.ts` only ever drives one `BiometricPrompt`.
 */
type AutofillNativeModule = {
  isSupported(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  openAutofillSettings(): Promise<void>;
  completeFill(username: string, password: string): Promise<void>;
  cancelFill(): Promise<void>;
  completeSave(): Promise<void>;
  discardSave(): Promise<void>;
};

const { Autofill } = NativeModules as { Autofill: AutofillNativeModule };

export default Autofill;
