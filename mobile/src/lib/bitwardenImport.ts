/**
 * Parses a Bitwarden unencrypted JSON vault export into ItemContent rows,
 * the JSON sibling of csvImport.ts. Ported from
 * extension/src/lib/bitwardenImport.ts rather than shared -- this repo's
 * established pattern -- and adapted to this app's `ItemContent`, where
 * every field is optional instead of defaulting to `""`.
 *
 * Logins, secure notes, cards and identities are recognised -- one step
 * further than the CSV importer, because Bitwarden's JSON schema (unlike
 * an arbitrary CSV's columns) is solidly confirmed: the numeric `type`
 * discriminator (1 login, 2 secure note, 3 card, 4 identity) and each
 * type's field names are consistent across Bitwarden's own docs and
 * multiple independently-built import/export tools built against real
 * exports.
 *
 * Deliberately not mapped, for the same "don't guess at an unclear field"
 * reason the CSV importer states: identity's company/dateOfBirth/nationalId
 * (not confirmed present in this schema), custom fields (`fields`), folders,
 * and attachments. Type 5 (SSH key) and anything else is skipped and
 * counted, not guessed at.
 */
import type { CardContent, IdentityContent, ItemContent, LoginContent, NoteContent } from '../itemContent';

interface BitwardenItem {
  type?: number;
  name?: string | null;
  notes?: string | null;
  login?: {
    username?: string | null;
    password?: string | null;
    uris?: { uri?: string | null }[] | null;
  };
  card?: {
    cardholderName?: string | null;
    number?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    code?: string | null;
  };
  identity?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    address1?: string | null;
    address2?: string | null;
    address3?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
}

export interface ImportResult {
  items: ItemContent[];
  /** Rows this version has no mapping for, or had nothing meaningful in them. */
  skipped: number;
}

function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function set<T extends object, K extends keyof T>(target: T, key: K, value: string): void {
  if (value !== '') target[key] = value as T[K];
}

/**
 * Parses a Bitwarden unencrypted JSON export into `ItemContent`s.
 *
 * Throws if `raw` isn't valid JSON or has no `items` array at all -- the
 * caller treats that as "not a Bitwarden export."
 */
function parseBitwardenJson(raw: string): ImportResult {
  const data = JSON.parse(raw) as { items?: BitwardenItem[] };
  if (!Array.isArray(data.items)) throw new Error('not a Bitwarden export');

  const items: ItemContent[] = [];
  let skipped = 0;

  for (const entry of data.items) {
    const notes = text(entry.notes);
    const name = text(entry.name);

    if (entry.type === 1) {
      const login = entry.login ?? {};
      const username = text(login.username);
      const password = text(login.password);
      if (username === '' && password === '') {
        skipped += 1;
        continue;
      }
      const item: LoginContent = { type: 'login' };
      set(item, 'username', username);
      set(item, 'password', password);
      set(item, 'url', text(login.uris?.[0]?.uri));
      set(item, 'notes', notes);
      set(item, 'name', name);
      items.push(item);
      continue;
    }

    if (entry.type === 2) {
      if (notes === '' && name === '') {
        skipped += 1;
        continue;
      }
      const item: NoteContent = { type: 'note' };
      set(item, 'notes', notes);
      set(item, 'name', name);
      items.push(item);
      continue;
    }

    if (entry.type === 3) {
      const card = entry.card ?? {};
      const number = text(card.number);
      if (number === '') {
        skipped += 1;
        continue;
      }
      const item: CardContent = { type: 'card' };
      set(item, 'cardholder', text(card.cardholderName));
      set(item, 'number', number);
      set(item, 'expiryMonth', text(card.expMonth));
      set(item, 'expiryYear', text(card.expYear));
      set(item, 'securityCode', text(card.code));
      set(item, 'notes', notes);
      set(item, 'name', name);
      items.push(item);
      continue;
    }

    if (entry.type === 4) {
      const identity = entry.identity ?? {};
      const firstName = text(identity.firstName);
      const lastName = text(identity.lastName);
      if (firstName === '' && lastName === '') {
        skipped += 1;
        continue;
      }
      const street2 = [text(identity.address2), text(identity.address3)].filter(part => part !== '').join(', ');
      const item: IdentityContent = { type: 'identity' };
      set(item, 'firstName', firstName);
      set(item, 'lastName', lastName);
      set(item, 'email', text(identity.email));
      set(item, 'phone', text(identity.phone));
      set(item, 'street', text(identity.address1));
      set(item, 'street2', street2);
      set(item, 'city', text(identity.city));
      set(item, 'state', text(identity.state));
      set(item, 'postalCode', text(identity.postalCode));
      set(item, 'country', text(identity.country));
      set(item, 'notes', notes);
      set(item, 'name', name);
      items.push(item);
      continue;
    }

    // type 5 (SSH key) and anything else: a shape this version does not map.
    skipped += 1;
  }

  return { items, skipped };
}

export { parseBitwardenJson };
