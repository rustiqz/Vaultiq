import { StyleSheet, Text, View } from 'react-native';
import LogoMark from './LogoMark';
import { colors, fonts } from './theme';

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
function CardPreview(props: { number: string; cardholder: string; expiryMonth: string; expiryYear: string; masked?: boolean }) {
  const brand = detectBrand(props.number);
  const shownNumber = props.masked === true
    ? `•••• •••• •••• ${props.number.replace(/\D/g, '').slice(-4) || '••••'}`
    : props.number === '' ? '•••• •••• •••• ••••' : groupDigits(props.number);

  return (
    <View style={styles.card}>
      <View style={styles.watermark}>
        <LogoMark variant="detailed" size={150} color={colors.onInk} tickColor={colors.onInk} />
      </View>
      <View style={styles.topRow}>
        <View style={styles.chip} />
        {brand !== '' && <Text style={styles.brand}>{brand}</Text>}
      </View>
      <Text style={styles.number}>{shownNumber}</Text>
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
    minHeight: 132,
    backgroundColor: colors.ink,
    borderRadius: 16,
    padding: 18,
    justifyContent: 'space-between',
    overflow: 'hidden',
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
    backgroundColor: colors.sage,
  },
  brand: {
    fontFamily: fonts.semiCondensedBold,
    fontSize: 13,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
  number: {
    fontFamily: fonts.mono,
    fontSize: 17,
    letterSpacing: 2,
    color: colors.onInk,
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
    color: colors.onInk,
    marginBottom: 4,
  },
  fieldValue: {
    fontFamily: fonts.mono,
    fontSize: 13,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.onInk,
  },
});

export default CardPreview;
export { detectBrand };
