import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import CardPreview from '../CardPreview';
import Icon from '../icons';
import ItemAvatar from '../ItemAvatar';
import { copyForAWhile } from '../lib/clipboard';
import type { VaultStackScreenProps } from '../navigation';
import { colors, fonts, spacing } from '../theme';
import { Button, DetailField, SecretField, showComingSoon, useConfirmDialog } from '../ui';
import { text } from '../itemContent';
import { useTotpCode } from '../useTotpCode';

const RING_SIZE = 216;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** The big live code, its countdown ring being the dial's sage arc (6q). */
function TotpCode(props: { secretB32: string; algorithm: string; digits: number; period: number }) {
  const { code, secondsLeft } = useTotpCode(props.secretB32, props.algorithm, props.digits, props.period);

  if (code === null || secondsLeft === null) return null;
  const progress = secondsLeft / props.period;
  const half = Math.ceil(code.length / 2);
  const grouped = `${code.slice(0, half)} ${code.slice(half)}`;

  return (
    <View style={styles.totpBlock}>
      <View style={styles.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE} viewBox="0 0 216 216">
          <Circle cx={108} cy={108} r={RING_RADIUS} stroke={colors.ink} strokeOpacity={0.16} strokeWidth={3} fill="none" />
          <Circle
            cx={108}
            cy={108}
            r={RING_RADIUS}
            stroke={colors.sage}
            strokeWidth={RING_STROKE}
            strokeDasharray={`${RING_CIRCUMFERENCE * progress} ${RING_CIRCUMFERENCE}`}
            fill="none"
            transform="rotate(-90 108 108)"
          />
        </Svg>
        <View style={styles.ringCenter}>
          <Text style={styles.ringSeconds}>{secondsLeft}</Text>
          <Text style={styles.ringSecondsLabel}>Seconds</Text>
        </View>
      </View>
      <Text style={styles.totpCode}>{grouped}</Text>
      <Pressable style={styles.copyCodeButton} onPress={() => copyForAWhile(code)}>
        <Icon name="copy" size={18} color={colors.onInk} />
        <Text style={styles.copyCodeText}>Copy code</Text>
      </Pressable>
    </View>
  );
}

function formatDate(millis: number): string {
  return new Date(millis).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ItemDetailScreen({ route }: VaultStackScreenProps<'ItemDetail'>) {
  const { item } = route.params;
  const c = item.content;
  const copy = (value: string) => () => copyForAWhile(value);
  const createdAt = typeof c.createdAt === 'number' ? c.createdAt : null;
  const lastModifiedAt = typeof c.lastModifiedAt === 'number' ? c.lastModifiedAt : null;
  const [cardRevealed, setCardRevealed] = useState(false);
  const { show, dialog } = useConfirmDialog();

  const typeLabel: Record<string, string> = {
    login: 'Login',
    card: 'Card',
    identity: text(c, 'name') !== '' ? `Identity · ${text(c, 'name')}` : 'Identity',
    note: 'Secure note',
    totp: 'Authenticator',
  };
  const identityFullName = [text(c, 'firstName'), text(c, 'lastName')].filter(Boolean).join(' ');

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {item.itemType !== 'totp' && item.itemType !== 'note' && (
          <View style={styles.header}>
            <ItemAvatar itemType={item.itemType} content={c} id={item.id} size={56} />
            <View style={styles.headerText}>
              <Text style={styles.headerTitle}>
                {item.itemType === 'identity' ? identityFullName || typeLabel.identity : text(c, 'name') || typeLabel[item.itemType]}
              </Text>
              <Text style={styles.headerSubtitle}>{typeLabel[item.itemType]}</Text>
            </View>
          </View>
        )}
        {item.itemType === 'note' && (
          <View style={styles.noteHeader}>
            <Text style={styles.noteTitle}>{text(c, 'name') || 'Secure note'}</Text>
            <Text style={styles.headerSubtitle}>Secure note</Text>
          </View>
        )}

        {item.itemType === 'login' && (
          <>
            <SecretField label="Password" value={text(c, 'password')} onCopy={copy(text(c, 'password'))} />
            {text(c, 'url') !== '' && <DetailField label="URL" value={text(c, 'url')} link onCopy={copy(text(c, 'url'))} />}
            <DetailField label="Username" value={text(c, 'username')} onCopy={copy(text(c, 'username'))} />
            <DetailField label="Email" value={text(c, 'email')} onCopy={copy(text(c, 'email'))} />
            <DetailField label="Mobile" value={text(c, 'mobile')} onCopy={copy(text(c, 'mobile'))} />
          </>
        )}

        {item.itemType === 'card' && (
          <>
            <CardPreview
              number={text(c, 'number')}
              cardholder={text(c, 'cardholder')}
              expiryMonth={text(c, 'expiryMonth')}
              expiryYear={text(c, 'expiryYear')}
              masked={!cardRevealed}
            />
            <View style={styles.row}>
              <Button title="Copy number" flex onPress={() => copyForAWhile(text(c, 'number'))} />
              <Pressable style={styles.revealButton} onPress={() => setCardRevealed(r => !r)}>
                <Text style={styles.revealButtonText}>{cardRevealed ? 'Hide' : 'Reveal'}</Text>
              </Pressable>
            </View>
            <DetailField label="Expiry" value={[text(c, 'expiryMonth'), text(c, 'expiryYear')].filter(Boolean).join('/')} />
            <DetailField label="CVV" value={text(c, 'securityCode')} secure onCopy={copy(text(c, 'securityCode'))} />
            <DetailField label="PIN" value={text(c, 'pin')} secure />
          </>
        )}

        {item.itemType === 'identity' && (
          <>
            <Pressable style={styles.autofillButton} onPress={() => showComingSoon(show, 'Autofilling an identity')}>
              <Icon name="identity" size={17} color={colors.onInk} />
              <Text style={styles.autofillButtonText}>Autofill this identity</Text>
            </Pressable>
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
            {createdAt === null && lastModifiedAt === null && (
              <View style={styles.noHistoryRow}>
                <Icon name="info" size={15} color={colors.ink} />
                <Text style={styles.noHistoryText}>Imported item · no history recorded</Text>
              </View>
            )}
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
            <DetailField label="Issuer" value={text(c, 'issuer')} />
            <DetailField label="Account" value={text(c, 'account')} />
          </>
        )}

        {(item.itemType === 'note' || text(c, 'notes') !== '') && (
          <DetailField label={item.itemType === 'note' ? 'Content' : 'Notes'} value={text(c, 'notes')} multiline />
        )}
      </ScrollView>
      {(createdAt !== null || lastModifiedAt !== null) && (
        <Text style={styles.timestamps}>
          {createdAt !== null ? `Created ${formatDate(createdAt)}` : ''}
          {createdAt !== null && lastModifiedAt !== null ? ' · ' : ''}
          {lastModifiedAt !== null ? `Modified ${formatDate(lastModifiedAt)}` : ''}
        </Text>
      )}
      {dialog}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  headerText: {
    gap: 3,
  },
  headerTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 30,
    lineHeight: 32,
    color: colors.ink,
  },
  headerSubtitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  noteHeader: {
    gap: 4,
  },
  noteTitle: {
    fontFamily: fonts.condensedSemiBold,
    fontSize: 32,
    lineHeight: 34,
    color: colors.ink,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
  },
  revealButton: {
    width: 104,
    height: 50,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealButtonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  autofillButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  autofillButtonText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
  noHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  noHistoryText: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  totpBlock: {
    alignItems: 'center',
    gap: spacing.md + 6,
    paddingVertical: spacing.xs,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    gap: 2,
  },
  ringSeconds: {
    fontFamily: fonts.mono,
    fontSize: 46,
    lineHeight: 48,
    color: colors.ink,
  },
  ringSecondsLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  totpCode: {
    fontFamily: fonts.mono,
    fontSize: 46,
    letterSpacing: 4,
    color: colors.ink,
  },
  copyCodeButton: {
    width: '100%',
    height: 54,
    borderRadius: 12,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  copyCodeText: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
  timestamps: {
    fontFamily: fonts.condensedBold,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.ink,
    textAlign: 'center',
    paddingBottom: spacing.md,
  },
});
