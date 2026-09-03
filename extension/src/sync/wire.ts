// Converting between how an item is stored and how it travels.
//
// The crypto core hands back byte arrays; JSON carries them as base64. That
// is a third the size of a JSON array of numbers, and the conversion is the
// only place the two representations meet.

import type { StoredItem } from "../lib/vault-db.js";

export interface WireItem {
  id: string;
  itemType: string;
  version: number;
  updatedAt: number;
  deleted: boolean;
  format: number;
  ciphertext: string;
  nonce: string;
}

function toBase64(bytes: number[]): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): number[] {
  const binary = atob(encoded);
  return Array.from(binary, (character) => character.charCodeAt(0));
}

export function toWire(item: StoredItem): WireItem {
  return {
    id: item.id,
    itemType: item.item_type,
    version: item.version,
    updatedAt: item.updated_at,
    deleted: item.deleted,
    format: item.format,
    ciphertext: toBase64(item.ciphertext),
    nonce: toBase64(item.nonce),
  };
}

export function fromWire(item: WireItem): StoredItem {
  return {
    id: item.id,
    item_type: item.itemType,
    version: item.version,
    updated_at: item.updatedAt,
    deleted: item.deleted,
    format: item.format,
    ciphertext: fromBase64(item.ciphertext),
    nonce: fromBase64(item.nonce),
  };
}
