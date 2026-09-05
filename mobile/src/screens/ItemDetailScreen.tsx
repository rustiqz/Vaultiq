import Clipboard from '@react-native-clipboard/clipboard';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { VaultStackScreenProps } from '../navigation';
import { colors, spacing } from '../theme';
import { DetailField } from '../ui';
import { text } from '../itemContent';
import { useTotpCode } from '../useTotpCode';

const RING_SIZE = 140;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** A live TOTP code with a circular countdown ring, refreshed every second. */
function TotpCode(props: { secretB32: string; algorithm: string; digits: number; period: number }) {
  const { code, secondsLeft } = useTotpCode(props.secretB32, props.algorithm, props.digits, props.period);

  if (code === null || secondsLeft === null) return null;
  const progress = secondsLeft / props.period;
  const half = Math.ceil(code.length / 2);
  const grouped = `${code.slice(0, half)} ${code.slice(half)}`;

  return (
    <Pressable style={styles.totp} onPress={() => Clipboard.setString(code)}>
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={colors.badge}
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <Circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={colors.primary}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            fill="none"
            rotation={-90}
            originX={RING_SIZE / 2}
            originY={RING_SIZE / 2}
          />
        </Svg>
        <View style={styles.ringCenter}>
          <Text style={styles.ringSeconds}>{secondsLeft}</Text>
          <Text style={styles.ringSecondsLabel}>SECONDS</Text>
        </View>
      </View>
      <Text style={styles.totpCode}>{grouped}</Text>
      <Text style={styles.secondary}>TAP TO COPY</Text>
    </Pressable>
  );
}

function formatDate(millis: number): string {
  return new Date(millis).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ItemDetailScreen({ route }: VaultStackScreenProps<'ItemDetail'>) {
  const { item } = route.params;
  const c = item.content;
  const copy = (value: string) => () => Clipboard.setString(value);
  const createdAt = typeof c.createdAt === 'number' ? c.createdAt : null;
  const lastModifiedAt = typeof c.lastModifiedAt === 'number' ? c.lastModifiedAt : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {item.itemType === 'login' && (
          <>
            {text(c, 'url') !== '' && <DetailField label="URL" value={text(c, 'url')} link onCopy={copy(text(c, 'url'))} />}
            <DetailField label="Username" value={text(c, 'username')} onCopy={copy(text(c, 'username'))} />
            <DetailField label="Password" value={text(c, 'password')} secure onCopy={copy(text(c, 'password'))} />
            <DetailField label="Email" value={text(c, 'email')} onCopy={copy(text(c, 'email'))} />
            <DetailField label="Mobile" value={text(c, 'mobile')} onCopy={copy(text(c, 'mobile'))} />
          </>
        )}
        {item.itemType === 'card' && (
          <>
            <DetailField label="Card Number" value={text(c, 'number')} secure onCopy={copy(text(c, 'number'))} />
            <View style={styles.row}>
              <View style={styles.half}>
                <DetailField label="Expiry" value={[text(c, 'expiryMonth'), text(c, 'expiryYear')].filter(Boolean).join('/')} />
              </View>
              <View style={styles.half}>
                <DetailField label="CVV" value={text(c, 'securityCode')} secure onCopy={copy(text(c, 'securityCode'))} />
              </View>
            </View>
            <DetailField label="Cardholder Name" value={text(c, 'cardholder')} />
            <DetailField label="PIN" value={text(c, 'pin')} secure />
          </>
        )}
        {item.itemType === 'identity' && (
          <>
            <DetailField label="Full Name" value={[text(c, 'firstName'), text(c, 'lastName')].filter(Boolean).join(' ')} />
            <DetailField label="Email" value={text(c, 'email')} onCopy={copy(text(c, 'email'))} />
            <DetailField label="Phone" value={text(c, 'phone')} onCopy={copy(text(c, 'phone'))} />
            <DetailField
              label="Address"
              value={[text(c, 'street'), text(c, 'city'), text(c, 'state'), text(c, 'postalCode')].filter(Boolean).join(', ')}
              onCopy={copy(
                [text(c, 'street'), text(c, 'city'), text(c, 'state'), text(c, 'postalCode'), text(c, 'country')]
                  .filter(Boolean)
                  .join(', '),
              )}
            />
            <DetailField label="Date of Birth" value={text(c, 'dateOfBirth')} />
            <DetailField label="Company" value={text(c, 'company')} />
            <DetailField label="Street 2" value={text(c, 'street2')} />
            <DetailField label="Country" value={text(c, 'country')} />
            {/* Masked wherever shown -- it opens accounts on its own (extension/src/lib/messages.ts). */}
            <DetailField label="National ID" value={text(c, 'nationalId')} secure />
          </>
        )}
        {item.itemType === 'totp' && (
          <>
            <TotpCode
              secretB32={text(c, 'secret')}
              algorithm={text(c, 'algorithm') || 'SHA1'}
              digits={typeof c.digits === 'number' ? c.digits : 6}
              period={typeof c.period === 'number' ? c.period : 30}
            />
            <View style={styles.totpMeta}>
              <DetailField label="Account" value={text(c, 'account')} />
              <DetailField label="Issuer" value={text(c, 'issuer')} />
            </View>
          </>
        )}
        {(item.itemType === 'note' || text(c, 'notes') !== '') && (
          <DetailField label={item.itemType === 'note' ? 'Secure Note Content' : 'Notes'} value={text(c, 'notes')} multiline />
        )}
      </ScrollView>
      {(createdAt !== null || lastModifiedAt !== null) && (
        <Text style={styles.timestamps}>
          {createdAt !== null ? `Created: ${formatDate(createdAt)}` : ''}
          {createdAt !== null && lastModifiedAt !== null ? ' · ' : ''}
          {lastModifiedAt !== null ? `Modified: ${formatDate(lastModifiedAt)}` : ''}
        </Text>
      )}
    </View>
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
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  totp: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  ringSeconds: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.heading,
  },
  ringSecondsLabel: {
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 1,
  },
  totpCode: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.heading,
    letterSpacing: 4,
    marginTop: spacing.sm,
  },
  totpMeta: {
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: spacing.md,
  },
  secondary: {
    color: colors.muted,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  timestamps: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'center',
    paddingBottom: spacing.md,
  },
});
