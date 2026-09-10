import { StyleSheet, Text, View } from 'react-native';
import LogoMark from './LogoMark';
import { brandColors, fonts } from './theme';

/**
 * Detects a card brand from its number's prefix -- just enough for the
 * label on the card face (6n/6h), not a real BIN lookup.
 */
function detectBrand(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (digits.startsWith('4')) return 'Visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  if (digits.startsWith('6')) return 'Discover';
  return '';
}

function groupDigits(number: string): string {
  const digits = number.replace(/\D/g, '');
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

/** The real card graphic from 6h/6n -- the design backlog's "card detail, not a field list" ask. */
function CardPreview(props: { number: string; cardholder: string; expiryMonth: string; expiryYear: string; masked?: boolean; size?: 'compact' | 'detail' }) {
  const brand = detectBrand(props.number);
  const detail = props.size === 'detail';
  const shownNumber = props.masked === true
    ? `•••• •••• •••• ${props.number.replace(/\D/g, '').slice(-4) || '••••'}`
    : props.number === '' ? '•••• •••• •••• ••••' : groupDigits(props.number);

  return (
    <View style={[styles.card, detail && styles.cardDetail]}>
      {detail && (
        <View style={styles.watermark}>
          <LogoMark variant="mono" size={150} color={brandColors.paper} />
        </View>
      )}
      <View style={styles.topRow}>
        <View style={[styles.chip, detail && styles.chipDetail]} />
        {brand !== '' && <Text style={[styles.brand, detail && styles.brandDetail]}>{brand}</Text>}
      </View>
      <Text style={[styles.number, detail && styles.numberDetail]}>{shownNumber}</Text>
      <View style={styles.bottomRow}>
        <View>
          <Text style={styles.fieldLabel}>Cardholder</Text>
          <Text style={styles.fieldValue}>{props.cardholder || '—'}</Text>
        </View>
        <View style={styles.bottomRight}>
          <Text style={styles.fieldLabel}>Expires</Text>
          <Text style={styles.fieldValue}>
            {props.expiryMonth || '--'}/{props.expiryYear || '--'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    height: 132,
    backgroundColor: brandColors.ink,
    borderRadius: 16,
    padding: 18,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardDetail: {
    height: 208,
    borderRadius: 18,
    padding: 22,
  },
  watermark: {
    position: 'absolute',
    right: -34,
    bottom: -40,
    opacity: 0.16,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  chip: {
    width: 34,
    height: 24,
    borderRadius: 4,
    backgroundColor: brandColors.sage,
  },
  chipDetail: {
    width: 44,
    height: 32,
    borderRadius: 5,
  },
  brand: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 13,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: brandColors.paper,
  },
  brandDetail: {
    fontSize: 16,
    letterSpacing: 2.56,
  },
  number: {
    fontFamily: fonts.mono,
    fontSize: 17,
    letterSpacing: 2,
    color: brandColors.paper,
  },
  numberDetail: {
    fontSize: 21,
    letterSpacing: 2.94,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  bottomRight: {
    alignItems: 'flex-end',
  },
  fieldLabel: {
    fontFamily: fonts.condensedBold,
    fontSize: 11.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: brandColors.paper,
    marginBottom: 4,
  },
  fieldValue: {
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: brandColors.paper,
  },
});

export default CardPreview;
export { detectBrand };
