// The protocol between the popup and the background context.
//
// The popup never holds a key. It sends a request, the background does the
// crypto, and only plaintext the user asked for comes back. Content scripts
// (a later phase) run inside pages and are the least trustworthy surface in
// the extension, so the same rule will apply to them.

/** `quick` means locked, but a PIN can reopen it without the master password. */
export type VaultStatus = "empty" | "locked" | "quick" | "unlocked";

/** Bands are anchored to the generator: only its default reaches the top. */
export type StrengthLevel = "very-weak" | "weak" | "fair" | "strong" | "excellent";

export interface PasswordStrength {
  bits: number;
  level: StrengthLevel;
}

export interface PasswordOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
}

/**
 * The kinds of thing a vault can hold.
 *
 * This lives in the *record header*, not in the encrypted content: it is
 * bound into each item's authentication tag, so a server cannot relabel a
 * secure note as a login and have it decrypt. The union below carries a
 * matching `type` for the popup's benefit, and it is stripped again before
 * anything is stored — one fact, one place.
 */
export type ItemType = "login" | "note" | "card" | "identity";

/** What every item carries, whatever its type. */
export interface CommonContent {
  /**
   * What to call this item.
   *
   * Optional, and it lives inside the encrypted content rather than beside
   * it — a server that could read "Work email" would learn a great deal
   * without decrypting anything. Items saved before this field existed simply
   * have none, and fall back to the username; nothing needs migrating,
   * because the AEAD layout and the associated data are unchanged.
   */
  name?: string;
  notes: string;

  /**
   * When this item was first saved, and when its content last changed.
   *
   * Inside the encrypted content, and only ever written when the content
   * itself does — so they cost nothing in version churn. Absent on anything
   * saved before these existed.
   */
  createdAt?: number;
  lastModifiedAt?: number;
}

export interface LoginContent extends CommonContent {
  type: "login";
  username: string;
  password: string;
  url: string;

  /** Optional, for forms that ask for one of these specifically. */
  email?: string;
  mobile?: string;
}

/**
 * A secure note: a name and free text, and deliberately nothing else.
 *
 * It adds no field of its own — `notes` is already common to every item, and
 * a note whose body lived in a second field would mean two text areas on one
 * form and two places for the same sentence to hide in.
 */
export type NoteContent = CommonContent & { type: "note" };

/**
 * A payment card.
 *
 * The expiry is two fields rather than one "MM/YY" string because that is the
 * shape a checkout form asks for — `cc-exp-month` and `cc-exp-year` are
 * separate inputs on most of them — and splitting a stored string at fill
 * time would only move the parsing somewhere less testable.
 */
export interface CardContent extends CommonContent {
  type: "card";
  cardholder: string;
  /** Digits only: spaces and dashes are normalized away as it is saved. */
  number: string;
  expiryMonth: string;
  expiryYear: string;
  securityCode: string;
  /** Some cards have one, most vaults never fill it in. */
  pin?: string;
}

/**
 * A person, as forms ask about one.
 *
 * The field names follow the HTML autocomplete tokens rather than any one
 * country's postal vocabulary — `state` is `address-level1`, `city` is
 * `address-level2` — because a form is what this will eventually be filled
 * into, and a schema that has to be translated at fill time is a schema that
 * will be translated differently by each client.
 *
 * Everything is a plain string, including the postcode: leading zeros are
 * real, and half the world's postcodes contain letters.
 */
export interface IdentityContent extends CommonContent {
  type: "identity";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;

  street: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;

  company?: string;
  /** ISO `YYYY-MM-DD`, which is what a date input reads and writes. */
  dateOfBirth?: string;
  /**
   * Passport number, national insurance number, Aadhaar, SSN.
   *
   * Masked wherever it is shown and kept out of the search index. It is the
   * one field here that opens accounts on its own.
   */
  nationalId?: string;
}

export type ItemContent = LoginContent | NoteContent | CardContent | IdentityContent;

/** What someone did with a login. */
export type UsageEvent = "created" | "edited" | "autofilled" | "copied" | "revealed";

/** One thing that happened, on one device. */
export interface AuditEvent {
  at: number;
  itemId: string;
  kind: UsageEvent;
}

/** What one device has done with one login. */
export interface DeviceSummary {
  deviceId: string;
  deviceName: string;
  count: number;
  lastAt: number;
}

/**
 * How often and how recently a login has been reached for.
 *
 * Deliberately *not* part of the item. Recording a use inside the encrypted
 * content would re-encrypt it and bump `version` on every autofill — and
 * `version` is what sync uses for optimistic concurrency, so two devices
 * filling the same login would collide constantly over nothing that changed.
 *
 * Kept in its own encrypted record instead: one blob, rewritten on use,
 * leaving item versions to mean what they say.
 */
export interface ItemUsage {
  lastUsedAt?: number;
  lastAutofilledAt?: number;
  useCount: number;
  /** Totals per kind, across every device. */
  counts: Partial<Record<UsageEvent, number>>;
  /** Which devices have reached for this login, most recent first. */
  devices: DeviceSummary[];
}

/** This browser, as the vault knows it. */
export interface DeviceIdentity {
  id: string;
  name: string;
}

/** What is true of every item once decrypted, whatever its type. */
export interface ItemFacts {
  id: string;
  updatedAt: number;
  /** In the trash. The content is still here and can be restored. */
  deleted: boolean;
  /** Zeroed for an item that has never been reached for. */
  usage: ItemUsage;
}

/** What only a login has: a password, and therefore something to say about it. */
export interface PasswordFacts {
  /**
   * How many *other* live logins share this password.
   *
   * Strength scoring cannot see this: a password can be long, varied and
   * excellent, and still be the one thing standing between a breach of one
   * site and every other account that reuses it.
   */
  reusedBy: number;
  /**
   * Scored in the background while the item is decrypted, so the popup does
   * not have to load the crypto module to show a badge.
   */
  strength: PasswordStrength;
}

/**
 * An item as the popup sees it: plaintext, and only while unlocked.
 *
 * A union rather than one wide shape with optional fields. The popup has to
 * branch on the type anyway to render it, and a union makes the compiler
 * insist on that instead of letting `item.password` be quietly undefined on
 * something that never had one.
 */
/**
 * What a card's number says about it, worked out where the item is decrypted.
 *
 * Derived rather than stored, like a password's strength: a stored brand
 * would be a copy that could disagree with the number it describes, and it
 * would have to be migrated the day the scheme list changes.
 */
export interface CardFacts {
  /** The scheme, or null for a number no list recognises. */
  brand: string | null;
  /** How a card is identified out loud. Empty if the number is too short. */
  last4: string;
}

export type DecryptedLogin = LoginContent & ItemFacts & PasswordFacts;
export type DecryptedNote = NoteContent & ItemFacts;
export type DecryptedCard = CardContent & ItemFacts & CardFacts;
export type DecryptedIdentity = IdentityContent & ItemFacts;

export type DecryptedItem =
  | DecryptedLogin
  | DecryptedNote
  | DecryptedCard
  | DecryptedIdentity;

import type { RemoteDevice } from "../sync/client.js";
import type { SyncOutcome } from "../sync/engine.js";

export type { RemoteDevice, SyncOutcome };

/** What the popup shows about this device's server, if it has one. */
export interface SyncSummary {
  connected: boolean;
  server?: string;
  lastSyncedAt?: number;
  lastError?: string;
}

/** Ordering the list offers. */
export type SortOrder = "recent" | "name";

export type Request =
  | { kind: "status" }
  | { kind: "create"; masterPassword: string }
  | { kind: "unlock"; masterPassword: string }
  // Re-wraps the vault key under a new password. The vault key does not
  // change, so nothing is re-encrypted and no item has to move.
  | { kind: "changeMasterPassword"; currentPassword: string; newPassword: string }
  | { kind: "lock"; forget?: boolean }
  | { kind: "setPin"; pin: string }
  | { kind: "forgetPin" }
  | { kind: "unlockWithPin"; pin: string }
  | { kind: "autoLock" }
  | { kind: "setAutoLock"; minutes: number }
  | { kind: "addItem"; content: ItemContent }
  | { kind: "updateItem"; id: string; content: ItemContent }
  // Moves to the trash: the content is kept and can be restored.
  | { kind: "trashItem"; id: string }
  | { kind: "restoreItem"; id: string }
  // Erases the content for good. The record itself stays, because a deletion
  // has to be able to propagate to other devices later.
  | { kind: "purgeItem"; id: string }
  | { kind: "listItems" }
  // Generation happens in the background like everything else, so the popup
  // never loads the crypto module itself.
  | { kind: "generatePassword"; options?: PasswordOptions }
  | { kind: "checkStrength"; password: string }
  // Deliberately takes no URL. The background reads the active tab itself —
  // a caller that could name its own site could enumerate the vault.
  | { kind: "itemsForSite" }
  // Notes that a login was reached for from the popup — copied, revealed, or
  // opened. Autofill records itself.
  | { kind: "recordUse"; id: string; event?: UsageEvent }
  | { kind: "device" }
  | { kind: "renameDevice"; name: string }
  | { kind: "auditLog" }
  // The only request that returns a password. Answered only for an item that
  // belongs to the sender's own site, so a compromised page cannot read
  // credentials for anywhere else.
  | { kind: "credentialForFill"; id: string }
  // Asks whether a just-submitted login is worth offering to save. Carries no
  // URL: the background uses the sender tab, as everywhere else.
  | { kind: "shouldOfferToSave"; username: string; password: string }
  // Saves it. Only reached after the user says yes in the page banner.
  | { kind: "saveSubmitted"; username: string; password: string; name?: string; notes?: string }
  // Syncing. The master password appears here only for the two connect
  // flows, which have to derive an auth key; nothing else needs it, and it
  // is never stored.
  | { kind: "syncStatus" }
  | { kind: "connectServer"; server: string; deviceName: string; masterPassword: string }
  | {
      kind: "enrollWithServer";
      server: string;
      token: string;
      deviceName: string;
      masterPassword: string;
    }
  | { kind: "syncNow" }
  | { kind: "disconnectServer" }
  | { kind: "remoteDevices" }
  | { kind: "newEnrollmentToken" }
  | { kind: "revokeRemoteDevice"; deviceId: string };

export type Response =
  | { ok: true; kind: "status"; status: VaultStatus }
  | { ok: true; kind: "create" }
  | { ok: true; kind: "unlock" }
  | { ok: true; kind: "changeMasterPassword" }
  | { ok: true; kind: "lock" }
  | { ok: true; kind: "setPin" }
  | { ok: true; kind: "forgetPin" }
  | { ok: true; kind: "unlockWithPin" }
  | { ok: true; kind: "autoLock"; minutes: number }
  | { ok: true; kind: "setAutoLock" }
  | { ok: true; kind: "addItem"; id: string }
  | { ok: true; kind: "updateItem" }
  | { ok: true; kind: "trashItem" }
  | { ok: true; kind: "restoreItem" }
  | { ok: true; kind: "purgeItem" }
  | { ok: true; kind: "listItems"; items: DecryptedItem[] }
  | { ok: true; kind: "generatePassword"; password: string }
  | { ok: true; kind: "checkStrength"; strength: PasswordStrength }
  // Logins only: a note has no site to belong to, so nothing else can be here.
  | { ok: true; kind: "itemsForSite"; site: string | null; items: DecryptedLogin[] }
  | { ok: true; kind: "recordUse" }
  | { ok: true; kind: "device"; device: DeviceIdentity }
  | { ok: true; kind: "renameDevice" }
  | { ok: true; kind: "auditLog"; events: AuditEvent[]; devices: DeviceIdentity[] }
  | { ok: true; kind: "credentialForFill"; username: string; password: string }
  | { ok: true; kind: "shouldOfferToSave"; offer: false }
  | { ok: true; kind: "shouldOfferToSave"; offer: true; site: string; existingId: string | null }
  | { ok: true; kind: "saveSubmitted" }
  | { ok: true; kind: "passwordOptions"; options: PasswordOptions }
  | { ok: true; kind: "syncStatus"; sync: SyncSummary }
  | { ok: true; kind: "connectServer" }
  | { ok: true; kind: "enrollWithServer" }
  | { ok: true; kind: "syncNow"; outcome: SyncOutcome }
  | { ok: true; kind: "disconnectServer" }
  | { ok: true; kind: "remoteDevices"; devices: RemoteDevice[] }
  | { ok: true; kind: "newEnrollmentToken"; token: string; expiresAt: string }
  | { ok: true; kind: "revokeRemoteDevice" }
  | { ok: false; error: string };

export async function send(request: Request): Promise<Response> {
  return (await browser.runtime.sendMessage(request)) as Response;
}
