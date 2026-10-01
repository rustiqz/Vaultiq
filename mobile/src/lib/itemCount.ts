/** The five item types a person can create. Anything else (e.g. 'usage') is internal bookkeeping. */
export const USER_ITEM_TYPES = ['login', 'note', 'card', 'identity', 'totp'] as const;

type CountableItem = { itemType: string; deleted: boolean };

/** Non-trashed items whose itemType is in USER_ITEM_TYPES. */
export function countUserItems(items: readonly CountableItem[]): number {
  return items.filter(item => !item.deleted && USER_ITEM_TYPES.some(type => type === item.itemType)).length;
}

/** Non-trashed items whose itemType is 'login'. */
export function countLogins(items: readonly CountableItem[]): number {
  return items.filter(item => !item.deleted && item.itemType === 'login').length;
}
