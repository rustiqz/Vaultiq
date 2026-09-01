// The protocol between the popup and the background context.
//
// The popup never holds a key. It sends a request, the background does the
// crypto, and only plaintext the user asked for comes back. Content scripts
// (a later phase) run inside pages and are the least trustworthy surface in
// the extension, so the same rule will apply to them.

export type VaultStatus = "empty" | "locked" | "unlocked";

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

export interface LoginContent {
  /**
   * What to call this login.
   *
   * Optional, and it lives inside the encrypted content rather than beside
   * it — a server that could read "Work email" would learn a great deal
   * without decrypting anything. Items saved before this field existed simply
   * have none, and fall back to the username; nothing needs migrating,
   * because the AEAD layout and the associated data are unchanged.
   */
  name?: string;
  username: string;
  password: string;
  url: string;
  notes: string;

  /** Optional, for forms that ask for one of these specifically. */
  email?: string;
  mobile?: string;

  /**
   * When this login was first saved, and when its content last changed.
   *
   * Inside the encrypted content, and only ever written when the content
   * itself does — so they cost nothing in version churn. Absent on anything
   * saved before these existed.
   */
  createdAt?: number;
  lastModifiedAt?: number;
}

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

/** An item as the popup sees it: plaintext, and only while unlocked. */
export interface DecryptedItem extends LoginContent {
  id: string;
  updatedAt: number;
  /** In the trash. The content is still here and can be restored. */
  deleted: boolean;
  /** Zeroed for a login that has never been reached for. */
  usage: ItemUsage;
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

/** Ordering the list offers. */
export type SortOrder = "recent" | "name";

export type Request =
  | { kind: "status" }
  | { kind: "create"; masterPassword: string }
  | { kind: "unlock"; masterPassword: string }
  | { kind: "lock" }
  | { kind: "addItem"; content: LoginContent }
  | { kind: "updateItem"; id: string; content: LoginContent }
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
  | { kind: "saveSubmitted"; username: string; password: string; name?: string; notes?: string };

export type Response =
  | { ok: true; kind: "status"; status: VaultStatus }
  | { ok: true; kind: "create" }
  | { ok: true; kind: "unlock" }
  | { ok: true; kind: "lock" }
  | { ok: true; kind: "addItem"; id: string }
  | { ok: true; kind: "updateItem" }
  | { ok: true; kind: "trashItem" }
  | { ok: true; kind: "restoreItem" }
  | { ok: true; kind: "purgeItem" }
  | { ok: true; kind: "listItems"; items: DecryptedItem[] }
  | { ok: true; kind: "generatePassword"; password: string }
  | { ok: true; kind: "checkStrength"; strength: PasswordStrength }
  | { ok: true; kind: "itemsForSite"; site: string | null; items: DecryptedItem[] }
  | { ok: true; kind: "recordUse" }
  | { ok: true; kind: "device"; device: DeviceIdentity }
  | { ok: true; kind: "renameDevice" }
  | { ok: true; kind: "auditLog"; events: AuditEvent[]; devices: DeviceIdentity[] }
  | { ok: true; kind: "credentialForFill"; username: string; password: string }
  | { ok: true; kind: "shouldOfferToSave"; offer: false }
  | { ok: true; kind: "shouldOfferToSave"; offer: true; site: string; existingId: string | null }
  | { ok: true; kind: "saveSubmitted" }
  | { ok: true; kind: "passwordOptions"; options: PasswordOptions }
  | { ok: false; error: string };

export async function send(request: Request): Promise<Response> {
  return (await browser.runtime.sendMessage(request)) as Response;
}
