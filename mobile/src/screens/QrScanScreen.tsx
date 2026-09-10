import { parseOtpauth } from '../lib/otpauth';
import { resolveQrScan } from '../lib/qrScanResult';
import type { VaultStackScreenProps } from '../navigation';
import QrScannerView from '../QrScannerView';

/**
 * A QR code containing an `otpauth://` URI, scanned live. Full-screen over
 * the camera preview, matching the "Autofill this identity" pattern of
 * doing the minimum a stub needs to become real rather than building a
 * whole camera-UI system -- one frame-processor-free scan, one result.
 */
export default function QrScanScreen({ navigation }: VaultStackScreenProps<'QrScan'>) {
  return (
    <QrScannerView
      title="Scan QR code"
      invalidMessage="That QR code is not a recognized authenticator setup code."
      onCancel={() => navigation.goBack()}
      onScan={value => {
        const parsed = parseOtpauth(value);
        if (parsed === null) return false;
        resolveQrScan(parsed);
        navigation.goBack();
        return true;
      }}
    />
  );
}
