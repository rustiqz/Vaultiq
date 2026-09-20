// Test fixtures use fake, obviously-not-real credentials (CLAUDE.md §2.6).

import { findMatch } from './importDedupe';
import type { ItemContent } from '../itemContent';
import type { DecryptedItem } from '../vault';

function existing(itemType: string, content: Record<string, unknown>, overrides: Partial<DecryptedItem> = {}): DecryptedItem {
  return { id: 'existing-id', itemType, version: 1, deleted: false, content, ...overrides };
}

describe('findMatch: login', () => {
  it('matches same username and site, case-insensitively', () => {
    const item: ItemContent = { type: 'login', username: 'alice@example.com', password: 'new', url: 'https://www.example.com', notes: '' };
    const existingItems = [existing('login', { username: 'Alice@example.com', password: 'old', url: 'https://example.com/login' })];
    const match = findMatch(item, existingItems);
    expect(match).not.toBeNull();
    expect(match?.identical).toBe(false);
  });

  it('reports identical when every field agrees', () => {
    const item: ItemContent = { type: 'login', username: 'alice', password: 'secret', url: 'https://example.com', notes: '' };
    const existingItems = [existing('login', { username: 'alice', password: 'secret', url: 'https://example.com', notes: '' })];
    expect(findMatch(item, existingItems)?.identical).toBe(true);
  });

  it('does not match a different username on the same site', () => {
    const item: ItemContent = { type: 'login', username: 'bob', password: '', url: 'https://example.com', notes: '' };
    const existingItems = [existing('login', { username: 'alice', url: 'https://example.com' })];
    expect(findMatch(item, existingItems)).toBeNull();
  });

  it('does not match an empty username', () => {
    const item: ItemContent = { type: 'login', username: '', password: '', url: 'https://example.com', notes: '' };
    const existingItems = [existing('login', { username: '', url: 'https://example.com' })];
    expect(findMatch(item, existingItems)).toBeNull();
  });

  it('falls back to username alone when either side has no url', () => {
    const item: ItemContent = { type: 'login', username: 'alice', password: '', url: 'https://example.com', notes: '' };
    const existingItems = [existing('login', { username: 'alice', url: '' })];
    expect(findMatch(item, existingItems)).not.toBeNull();
  });

  it('never matches a trashed item', () => {
    const item: ItemContent = { type: 'login', username: 'alice', password: '', url: 'https://example.com', notes: '' };
    const existingItems = [existing('login', { username: 'alice', url: 'https://example.com' }, { deleted: true })];
    expect(findMatch(item, existingItems)).toBeNull();
  });

  it('carries the matched item\'s id and version, for replace', () => {
    const item: ItemContent = { type: 'login', username: 'alice', password: '', url: 'https://example.com', notes: '' };
    const existingItems = [existing('login', { username: 'alice', url: 'https://example.com' }, { id: 'abc-123', version: 4 })];
    const match = findMatch(item, existingItems);
    expect(match?.id).toBe('abc-123');
    expect(match?.version).toBe(4);
  });
});

describe('findMatch: card', () => {
  it('matches on digits alone, ignoring formatting', () => {
    const item: ItemContent = { type: 'card', number: '4242-4242-4242-4242' };
    const existingItems = [existing('card', { number: '4242 4242 4242 4242' })];
    expect(findMatch(item, existingItems)).not.toBeNull();
  });
});

describe('findMatch: identity', () => {
  it('matches on first and last name', () => {
    const item: ItemContent = { type: 'identity', firstName: 'ada', lastName: 'lovelace' };
    const existingItems = [existing('identity', { firstName: 'Ada', lastName: 'Lovelace' })];
    expect(findMatch(item, existingItems)).not.toBeNull();
  });
});

describe('findMatch: totp', () => {
  it('matches on issuer and account', () => {
    const item: ItemContent = { type: 'totp', issuer: 'github', account: 'alice' };
    const existingItems = [existing('totp', { issuer: 'GitHub', account: 'alice' })];
    expect(findMatch(item, existingItems)).not.toBeNull();
  });
});

describe('findMatch: note', () => {
  it('matches on name when both have one', () => {
    const item: ItemContent = { type: 'note', name: 'wifi password', notes: 'new body' };
    const existingItems = [existing('note', { name: 'Wifi password', notes: 'old body' })];
    expect(findMatch(item, existingItems)?.identical).toBe(false);
  });

  it('falls back to matching the note body when neither has a name', () => {
    const item: ItemContent = { type: 'note', notes: 'same body' };
    const existingItems = [existing('note', { notes: 'same body' })];
    expect(findMatch(item, existingItems)?.identical).toBe(true);
  });
});

describe('findMatch: no match', () => {
  it('returns null when nothing lines up', () => {
    const item: ItemContent = { type: 'login', username: 'carol', password: '', url: 'https://other.example', notes: '' };
    const existingItems = [existing('login', { username: 'alice', url: 'https://example.com' })];
    expect(findMatch(item, existingItems)).toBeNull();
  });
});
