// Test fixtures use fake, obviously-not-real credentials.

import { parseProtonPassJson } from './protonPassImport';

function exportOf(items: unknown[]): string {
  return JSON.stringify({ encrypted: false, userId: 'u1', vaults: { v1: { name: 'Personal', items } } });
}

describe('parseProtonPassJson', () => {
  it('maps a login item', () => {
    const raw = exportOf([
      {
        state: 1,
        data: {
          type: 'login',
          metadata: { name: 'Example', note: 'a note' },
          content: { username: 'alice', password: 'hunter2', urls: ['https://example.com'] },
        },
      },
    ]);
    const { items, skipped } = parseProtonPassJson(raw);
    expect(skipped).toBe(0);
    expect(items).toEqual([
      { type: 'login', username: 'alice', password: 'hunter2', url: 'https://example.com', notes: 'a note', name: 'Example' },
    ]);
  });

  it('maps a secure note item', () => {
    const raw = exportOf([{ state: 1, data: { type: 'note', metadata: { name: 'Wifi password', note: 'the notes body' } } }]);
    const { items, skipped } = parseProtonPassJson(raw);
    expect(skipped).toBe(0);
    expect(items).toEqual([{ type: 'note', notes: 'the notes body', name: 'Wifi password' }]);
  });

  it('skips and counts a trashed item', () => {
    const raw = exportOf([
      { state: 2, data: { type: 'login', metadata: { name: 'Old' }, content: { username: 'alice', password: 'hunter2' } } },
    ]);
    const { items, skipped } = parseProtonPassJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts an item type not mapped in this version', () => {
    const raw = exportOf([{ state: 1, data: { type: 'creditCard', metadata: { name: 'My Visa' } } }]);
    const { items, skipped } = parseProtonPassJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts a login with neither username nor password', () => {
    const raw = exportOf([{ state: 1, data: { type: 'login', metadata: {}, content: { username: '', password: '' } } }]);
    const { items, skipped } = parseProtonPassJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts a note with no name and no notes', () => {
    const raw = exportOf([{ state: 1, data: { type: 'note', metadata: {} } }]);
    const { items, skipped } = parseProtonPassJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('takes the first non-empty url', () => {
    const raw = exportOf([
      {
        state: 1,
        data: { type: 'login', metadata: {}, content: { username: 'alice', password: 'hunter2', urls: ['', 'https://example.com'] } },
      },
    ]);
    const { items } = parseProtonPassJson(raw);
    expect(items[0]).toMatchObject({ url: 'https://example.com' });
  });

  it('merges items across multiple vaults', () => {
    const raw = JSON.stringify({
      vaults: {
        v1: { name: 'Personal', items: [{ state: 1, data: { type: 'note', metadata: { name: 'A', note: 'a' } } }] },
        v2: { name: 'Work', items: [{ state: 1, data: { type: 'note', metadata: { name: 'B', note: 'b' } } }] },
      },
    });
    const { items } = parseProtonPassJson(raw);
    expect(items).toHaveLength(2);
  });

  it('leaves name out entirely rather than an empty string', () => {
    const raw = exportOf([{ state: 1, data: { type: 'login', metadata: {}, content: { username: 'alice', password: 'hunter2' } } }]);
    const { items } = parseProtonPassJson(raw);
    expect(items[0]).not.toHaveProperty('name');
  });

  it('throws on something that is not a Proton Pass export', () => {
    expect(() => parseProtonPassJson(JSON.stringify({ items: [] }))).toThrow();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseProtonPassJson('not json')).toThrow();
  });
});
