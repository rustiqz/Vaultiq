import Clipboard from '@react-native-clipboard/clipboard';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import CryptoCore from '../nativeCryptoCore';
import type { VaultStackScreenProps } from '../navigation';
import { colors, spacing } from '../theme';
import { DetailField } from '../ui';
import { text } from '../itemContent';

/** A live TOTP code, refreshed every second. */
function TotpCode(props: { secretB32: string; algorithm: string; digits: number; period: number }) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const now = Date.now() / 1000;
      const [nextCode, remaining] = await Promise.all([
        CryptoCore.totpCode(props.secretB32, props.algorithm, props.digits, props.period, now),
        CryptoCore.totpSecondsRemaining(props.period, now),
      ]);
      if (!cancelled) {
        setCode(nextCode);
        setSecondsLeft(Math.ceil(remaining));
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [props.secretB32, props.algorithm, props.digits, props.period]);

  if (code === null) return null;
  return (
    <View style={styles.totp}>
      <Text style={styles.totpCode} onPress={() => Clipboard.setString(code)}>
        {code}
      </Text>
      <Text style={styles.secondary}>{secondsLeft}s remaining — tap to copy</Text>
    </View>
  );
}

export default function ItemDetailScreen({ route }: VaultStackScreenProps<'ItemDetail'>) {
  const { item } = route.params;
  const c = item.content;
  const copy = (value: string) => () => Clipboard.setString(value);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {item.itemType === 'login' && (
        <>
          {text(c, 'url') !== '' && <DetailField label="URL" value={text(c, 'url')} onCopy={copy(text(c, 'url'))} />}
          <DetailField label="Username" value={text(c, 'username')} onCopy={copy(text(c, 'username'))} />
          <DetailField label="Password" value={text(c, 'password')} secure onCopy={copy(text(c, 'password'))} />
          <DetailField label="Email" value={text(c, 'email')} onCopy={copy(text(c, 'email'))} />
          <DetailField label="Mobile" value={text(c, 'mobile')} onCopy={copy(text(c, 'mobile'))} />
        </>
      )}
      {item.itemType === 'card' && (
        <>
          <DetailField label="Cardholder" value={text(c, 'cardholder')} />
          <DetailField label="Card Number" value={text(c, 'number')} secure onCopy={copy(text(c, 'number'))} />
          <DetailField
            label="Expiry"
            value={[text(c, 'expiryMonth'), text(c, 'expiryYear')].filter(Boolean).join('/')}
          />
          <DetailField label="Security Code" value={text(c, 'securityCode')} secure onCopy={copy(text(c, 'securityCode'))} />
          <DetailField label="PIN" value={text(c, 'pin')} secure />
        </>
      )}
      {item.itemType === 'identity' && (
        <>
          <DetailField label="Full Name" value={[text(c, 'firstName'), text(c, 'lastName')].filter(Boolean).join(' ')} />
          <DetailField label="Email" value={text(c, 'email')} onCopy={copy(text(c, 'email'))} />
          <DetailField label="Phone" value={text(c, 'phone')} onCopy={copy(text(c, 'phone'))} />
          <DetailField label="Company" value={text(c, 'company')} />
          <DetailField label="Street" value={text(c, 'street')} />
          <DetailField label="Street 2" value={text(c, 'street2')} />
          <DetailField label="City" value={text(c, 'city')} />
          <DetailField label="State" value={text(c, 'state')} />
          <DetailField label="Postal Code" value={text(c, 'postalCode')} />
          <DetailField label="Country" value={text(c, 'country')} />
          <DetailField label="Date of Birth" value={text(c, 'dateOfBirth')} />
          {/* Masked wherever shown -- it opens accounts on its own (extension/src/lib/messages.ts). */}
          <DetailField label="National ID" value={text(c, 'nationalId')} secure />
        </>
      )}
      {item.itemType === 'totp' && (
        <>
          <DetailField label="Issuer" value={text(c, 'issuer')} />
          <DetailField label="Account" value={text(c, 'account')} />
          <TotpCode
            secretB32={text(c, 'secret')}
            algorithm={text(c, 'algorithm') || 'SHA1'}
            digits={typeof c.digits === 'number' ? c.digits : 6}
            period={typeof c.period === 'number' ? c.period : 30}
          />
        </>
      )}
      {(item.itemType === 'note' || text(c, 'notes') !== '') && (
        <DetailField label={item.itemType === 'note' ? 'Secure Note Content' : 'Notes'} value={text(c, 'notes')} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  totp: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  totpCode: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.heading,
    letterSpacing: 4,
  },
  secondary: {
    color: colors.muted,
    fontSize: 12,
  },
});
