/**
 * The plaintext schemas inside each item type's encrypted content --
 * mirrors extension/src/lib/messages.ts's `ItemContent` union, trimmed to
 * what this app renders. Deliberately excludes what that file derives at
 * decrypt time and this app doesn't compute (password-reuse count, card
 * brand, usage stats): those are UX enrichments with no plumbing here yet,
 * not part of the stored content itself.
 */
type CommonContent = {
  name?: string;
  notes?: string;
  /**
   * Mobile-only field: no mockup or extension equivalent exists for this
   * (the extension has no favoriting concept at all). Content is fully
   * client-encrypted and arbitrary, so this needed no server or extension
   * change -- just a field this app writes and reads.
   */
  favorite?: boolean;
};

type LoginContent = CommonContent & {
  type: 'login';
  username?: string;
  password?: string;
  url?: string;
  email?: string;
  mobile?: string;
};

type NoteContent = CommonContent & { type: 'note' };

type CardContent = CommonContent & {
  type: 'card';
  cardholder?: string;
  number?: string;
  expiryMonth?: string;
  expiryYear?: string;
  securityCode?: string;
  pin?: string;
};

type IdentityContent = CommonContent & {
  type: 'identity';
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  company?: string;
  dateOfBirth?: string;
  nationalId?: string;
};

type TotpContent = CommonContent & {
  type: 'totp';
  issuer?: string;
  account?: string;
  secret?: string;
  algorithm?: string;
  digits?: number;
  period?: number;
};

type ItemContent = LoginContent | NoteContent | CardContent | IdentityContent | TotpContent;

function text(content: Record<string, unknown>, field: string): string {
  const value = content[field];
  return typeof value === 'string' ? value : '';
}

/**
 * The row/header title shown for an item. Identity is the one exception --
 * its `name` field is repurposed by the redesign as a Personal/Work label
 * (see IdentityWizard.tsx), not the display title, so the person's actual
 * name takes priority there.
 */
function displayName(itemType: string, content: Record<string, unknown>, id: string): string {
  if (itemType === 'identity') {
    const fullName = [text(content, 'firstName'), text(content, 'lastName')].filter(Boolean).join(' ');
    if (fullName !== '') return fullName;
  }
  return text(content, 'name') || text(content, 'username') || text(content, 'cardholder') || `${itemType} ${id.slice(0, 8)}`;
}

/** A blank content object for a freshly chosen type, for the new-item form to seed its fields from. */
function emptyContent(itemType: ItemContent['type']): ItemContent {
  return { type: itemType, name: '' } as ItemContent;
}

export { displayName, emptyContent, text };
export type { CardContent, IdentityContent, ItemContent, LoginContent, NoteContent, TotpContent };
