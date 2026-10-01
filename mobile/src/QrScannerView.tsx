import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from './icons';
import { colors, fonts, spacing } from './theme';
import { Button } from './ui';

/** Shared camera shell for enrollment and authenticator QR codes. */
export default function QrScannerView(props: {
  title: string;
  invalidMessage: string;
  onCancel: () => void;
  /** Return true only after accepting and handling the scanned value. */
  onScan: (value: string) => boolean;
}) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [scanError, setScanError] = useState<string | null>(null);
  const [handled, setHandled] = useState(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const onCode = useCallback(
    (value: string | undefined) => {
      if (handled || value === undefined) return;
      if (!props.onScan(value)) {
        setScanError(props.invalidMessage);
        return;
      }
      setHandled(true);
    },
    [handled, props],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => onCode(codes[0]?.value),
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={props.onCancel} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.onInk} />
        </Pressable>
        <Text style={styles.appBarTitle}>{props.title}</Text>
      </View>

      {hasPermission && device !== undefined && (
        <Camera style={StyleSheet.absoluteFill} device={device} isActive={!handled} codeScanner={codeScanner} />
      )}

      {!hasPermission && (
        <View style={styles.centered}>
          <Text style={styles.message}>Vaultiq needs camera access to scan a QR code.</Text>
          <Button title="Grant camera access" onPress={() => requestPermission()} />
        </View>
      )}
      {hasPermission && device === undefined && (
        <View style={styles.centered}>
          <Text style={styles.message}>No usable camera was found on this device.</Text>
        </View>
      )}

      {scanError !== null && (
        <View style={styles.errorBanner}>
          <Icon name="alertTriangle" size={16} color={colors.onInk} />
          <Text style={styles.errorBannerText}>{scanError}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    zIndex: 1,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  appBarTitle: { fontFamily: fonts.condensedBold, fontSize: 22, color: colors.onInk },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  message: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.onInk, textAlign: 'center' },
  errorBanner: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.rust,
    padding: spacing.md,
    borderRadius: 12,
  },
  errorBannerText: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.onInk },
});
