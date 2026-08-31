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
  username: string;
  password: string;
  url: string;
  notes: string;
}

/** An item as the popup sees it: plaintext, and only while unlocked. */
export interface DecryptedItem extends LoginContent {
  id: string;
  updatedAt: number;
  /** In the trash. The content is still here and can be restored. */
  deleted: boolean;
  /**
   * Scored in the background while the item is decrypted, so the popup does
   * not have to load the crypto module to show a badge.
   */
  strength: PasswordStrength;
}

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
  | { kind: "checkStrength"; password: string };

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
  | { ok: true; kind: "passwordOptions"; options: PasswordOptions }
  | { ok: false; error: string };

export async function send(request: Request): Promise<Response> {
  return (await browser.runtime.sendMessage(request)) as Response;
}
