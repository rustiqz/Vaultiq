/**
 * Returns a new content object with the header's itemType. The header is
 * bound into AEAD associated data; the payload's type is not authoritative.
 */
export function contentWithType(
  itemType: string,
  content: Record<string, unknown>,
): Record<string, unknown> {
  return {...content, type: itemType};
}
