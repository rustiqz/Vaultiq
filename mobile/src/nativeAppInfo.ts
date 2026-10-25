import { NativeModules } from 'react-native';

/**
 * Typed wrapper around the `AppInfo` native module (see
 * android/app/src/main/java/com/vaultiq/mobile/AppInfoModule.kt): the
 * installed APK's version as the OS reports it.
 */
type AppVersion = { versionName: string; versionCode: number };

type AppInfoNativeModule = {
  version(): Promise<AppVersion>;
};

const { AppInfo } = NativeModules as { AppInfo: AppInfoNativeModule };

export default AppInfo;
export type { AppVersion };
