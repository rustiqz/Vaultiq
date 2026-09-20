/**
 * Matching an imported row against what's already in the vault, so an
 * import doesn't silently create a duplicate of something already there --
 * ported from extension/src/lib/importDedupe.ts, not shared, the same
 * relationship this app's other ported importers already have with theirs.
 *
 * Two levels: an "identity" match (plausibly the same real-world login,
 * card, identity, TOTP account, or note -- by the fields that actually name
 * it) and, within that, an "identical" match (every field import can set
 * agrees too). Only the identical case is safe to default to skipping -- a
 * same-identity-different-content match (a rotated password, say) is
 * surfaced to the screen, never silently merged or overwritten.
 */
import { displayName, text, type ItemContent } from '../itemContent';
import type { DecryptedItem } from '../vault';

function norm(value: string | number | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function cardDigits(value: string | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * The host a login URL belongs to, for matching purposes only -- a light
 * hostname strip, not `tldts`-grade public-suffix awareness: a false
 * positive here costs nothing worse than a badge on the wrong row, not
 * worth a new native dependency for this feature alone.
 */
function urlHost(url: string | undefined): string {
  const trimmed = (url ?? '').trim().toLowerCase();
  if (trimmed === '') return '';
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const host = withoutScheme.split(/[/?#]/)[0]?.split(':')[0] ?? '';
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** Whether two items plausibly describe the same real-world login/card/etc. */
function sameIdentity(item: ItemContent, existing: DecryptedItem): boolean {
  if (item.type !== existing.itemType) return false;
  const ex = existing.content;

  switch (item.type) {
    case 'login': {
      const username = norm(item.username);
      if (username === '' || username !== norm(text(ex, 'username'))) return false;
      const hostA = urlHost(item.url);
      const hostB = urlHost(text(ex, 'url'));
      // No URL on either side (a CSV row with no url column, say) falls
      // back to matching on username alone rather than never matching.
      return hostA === '' || hostB === '' || hostA === hostB;
    }
    case 'card': {
      const digits = cardDigits(item.number);
      return digits !== '' && digits === cardDigits(text(ex, 'number'));
    }
    case 'identity': {
      const name = `${norm(item.firstName)} ${norm(item.lastName)}`.trim();
      return name !== '' && name === `${norm(text(ex, 'firstName'))} ${norm(text(ex, 'lastName'))}`.trim();
    }
    case 'totp': {
      const key = `${norm(item.issuer)} ${norm(item.account)}`.trim();
      return key !== '' && key === `${norm(text(ex, 'issuer'))} ${norm(text(ex, 'account'))}`.trim();
    }
    case 'note': {
      const name = norm(item.name);
      if (name !== '') return name === norm(text(ex, 'name'));
      const notes = norm(item.notes);
      return notes !== '' && notes === norm(text(ex, 'notes'));
    }
  }
}

/** Whether two same-type items agree on every field an import can set. */
function sameContent(item: ItemContent, existing: DecryptedItem): boolean {
  if (item.type !== existing.itemType) return false;
  const ex = existing.content;

  switch (item.type) {
    case 'login':
      return (
        norm(item.username) === norm(text(ex, 'username')) &&
        norm(item.password) === norm(text(ex, 'password')) &&
        norm(item.url) === norm(text(ex, 'url')) &&
        norm(item.notes) === norm(text(ex, 'notes')) &&
        norm(item.name) === norm(text(ex, 'name')) &&
        norm(item.email) === norm(text(ex, 'email')) &&
        norm(item.mobile) === norm(text(ex, 'mobile'))
      );
    case 'card':
      return (
        cardDigits(item.number) === cardDigits(text(ex, 'number')) &&
        norm(item.cardholder) === norm(text(ex, 'cardholder')) &&
        norm(item.expiryMonth) === norm(text(ex, 'expiryMonth')) &&
        norm(item.expiryYear) === norm(text(ex, 'expiryYear')) &&
        norm(item.securityCode) === norm(text(ex, 'securityCode')) &&
        norm(item.pin) === norm(text(ex, 'pin')) &&
        norm(item.notes) === norm(text(ex, 'notes')) &&
        norm(item.name) === norm(text(ex, 'name'))
      );
    case 'identity':
      return (
        norm(item.firstName) === norm(text(ex, 'firstName')) &&
        norm(item.lastName) === norm(text(ex, 'lastName')) &&
        norm(item.email) === norm(text(ex, 'email')) &&
        norm(item.phone) === norm(text(ex, 'phone')) &&
        norm(item.street) === norm(text(ex, 'street')) &&
        norm(item.street2) === norm(text(ex, 'street2')) &&
        norm(item.city) === norm(text(ex, 'city')) &&
        norm(item.state) === norm(text(ex, 'state')) &&
        norm(item.postalCode) === norm(text(ex, 'postalCode')) &&
        norm(item.country) === norm(text(ex, 'country')) &&
        norm(item.company) === norm(text(ex, 'company')) &&
        norm(item.dateOfBirth) === norm(text(ex, 'dateOfBirth')) &&
        norm(item.nationalId) === norm(text(ex, 'nationalId')) &&
        norm(item.notes) === norm(text(ex, 'notes')) &&
        norm(item.name) === norm(text(ex, 'name'))
      );
    case 'totp': {
      const exDigits = ex.digits;
      const exPeriod = ex.period;
      return (
        norm(item.issuer) === norm(text(ex, 'issuer')) &&
        norm(item.account) === norm(text(ex, 'account')) &&
        norm(item.secret) === norm(text(ex, 'secret')) &&
        norm(item.algorithm) === norm(text(ex, 'algorithm')) &&
        norm(item.digits ?? 6) === norm(typeof exDigits === 'number' ? exDigits : 6) &&
        norm(item.period ?? 30) === norm(typeof exPeriod === 'number' ? exPeriod : 30) &&
        norm(item.notes) === norm(text(ex, 'notes')) &&
        norm(item.name) === norm(text(ex, 'name'))
      );
    }
    case 'note':
      return norm(item.notes) === norm(text(ex, 'notes')) && norm(item.name) === norm(text(ex, 'name'));
  }
}

export interface DedupeMatch {
  id: string;
  version: number;
  label: string;
  /** Every field import can set already agrees -- safe to default to skipping. */
  identical: boolean;
}

/** The first live (non-trashed), same-identity item already in the vault, if any. */
export function findMatch(item: ItemContent, existing: DecryptedItem[]): DedupeMatch | null {
  for (const candidate of existing) {
    if (candidate.deleted) continue;
    if (!sameIdentity(item, candidate)) continue;
    return {
      id: candidate.id,
      version: candidate.version,
      label: displayName(candidate.itemType, candidate.content, candidate.id),
      identical: sameContent(item, candidate),
    };
  }
  return null;
}
