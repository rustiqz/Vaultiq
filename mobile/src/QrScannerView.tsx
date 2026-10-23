import { useCallback, useEffect, useState } from 'react';
import { BackHandler, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Code, Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
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
  const [preview, setPreview] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // The scanner is also shown before any navigator exists (enrollment), where
  // the system back gesture has nothing to pop and would close the app.
  // Routing it to the same cancel the on-screen button uses keeps both paths
  // behaving identically.
  const { onCancel } = props;
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

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

  // `regionOfInterest` is iOS-only in VisionCamera, so the viewfinder is
  // enforced here: a code only counts when its centre lies inside the square.
  // Code frames are in preview dp, the same space as this view's layout.
  const inViewfinder = useCallback(
    (code: Code) => {
      if (code.frame === undefined || preview.width === 0) return false;
      const side = Math.min(preview.width, preview.height) * VIEWFINDER_RATIO;
      const left = (preview.width - side) / 2;
      const top = (preview.height - side) / 2;
      const cx = code.frame.x + code.frame.width / 2;
      const cy = code.frame.y + code.frame.height / 2;
      return cx >= left && cx <= left + side && cy >= top && cy <= top + side;
    },
    [preview],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: codes => onCode(codes.find(inViewfinder)?.value),
  });

  const onLayout = (e: LayoutChangeEvent) =>
    setPreview({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* A solid bar, not text laid over the live feed: the camera image can be
          any colour, including the cream this text is drawn in. */}
      <View style={styles.appBar}>
        <Pressable style={styles.back} onPress={props.onCancel} accessibilityRole="button" accessibilityLabel="Back">
          <Icon name="chevronLeft" size={22} color={colors.onInk} />
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
        <Text style={styles.appBarTitle}>{props.title}</Text>
      </View>

      <View style={styles.stage} onLayout={onLayout}>
        {hasPermission && device !== undefined && (
          <Camera style={StyleSheet.absoluteFill} device={device} isActive={!handled} codeScanner={codeScanner} />
        )}

        {hasPermission && device !== undefined && (
          <View style={styles.overlay} pointerEvents="none">
            <View style={[styles.viewfinder, { width: viewfinderSide(preview), height: viewfinderSide(preview) }]}>
              <View style={[styles.corner, styles.tl]} />
              <View style={[styles.corner, styles.tr]} />
              <View style={[styles.corner, styles.bl]} />
              <View style={[styles.corner, styles.br]} />
            </View>
            <Text style={styles.hint}>Point the camera at the QR code inside the square</Text>
          </View>
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
      </View>
    </SafeAreaView>
  );
}

const VIEWFINDER_RATIO = 0.7;
const viewfinderSide = (p: { width: number; height: number }) => Math.min(p.width, p.height) * VIEWFINDER_RATIO;
const CORNER = 28;

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  viewfinder: { borderRadius: 4 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.onInk },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.onInk, textAlign: 'center', paddingHorizontal: spacing.lg },
  container: { flex: 1, backgroundColor: colors.ink },
  appBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    backgroundColor: colors.ink,
  },
  back: { height: 44, flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  backLabel: { fontFamily: fonts.body, fontSize: 15, color: colors.onInk },
  stage: { flex: 1, overflow: 'hidden' },
  appBarTitle: { flex: 1, fontFamily: fonts.condensedBold, fontSize: 22, color: colors.onInk, textAlign: 'right', paddingRight: 12 },
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
