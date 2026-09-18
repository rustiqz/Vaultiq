// Test fixtures use fake, obviously-not-real credentials (CLAUDE.md §2.6).

import { parseBitwardenJson } from './bitwardenImport';

function exportOf(items: unknown[]): string {
  return JSON.stringify({ encrypted: false, folders: [], items });
}

describe('parseBitwardenJson', () => {
  it('maps a login item', () => {
    const raw = exportOf([
      {
        type: 1,
        name: 'Example',
        notes: 'a note',
        login: { username: 'alice', password: 'hunter2', uris: [{ uri: 'https://example.com' }] },
      },
    ]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(skipped).toBe(0);
    expect(items).toEqual([
      { type: 'login', username: 'alice', password: 'hunter2', url: 'https://example.com', notes: 'a note', name: 'Example' },
    ]);
  });

  it('maps a secure note item', () => {
    const raw = exportOf([{ type: 2, name: 'Wifi password', notes: 'the notes body' }]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(skipped).toBe(0);
    expect(items).toEqual([{ type: 'note', notes: 'the notes body', name: 'Wifi password' }]);
  });

  it('maps a card item', () => {
    const raw = exportOf([
      {
        type: 3,
        name: 'My Visa',
        card: { cardholderName: 'Alice Example', number: '4111111111111111', expMonth: '4', expYear: '2030', code: '123' },
      },
    ]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(skipped).toBe(0);
    expect(items).toEqual([
      {
        type: 'card',
        cardholder: 'Alice Example',
        number: '4111111111111111',
        expiryMonth: '4',
        expiryYear: '2030',
        securityCode: '123',
        name: 'My Visa',
      },
    ]);
  });

  it('maps an identity item, joining address2 and address3 into street2', () => {
    const raw = exportOf([
      {
        type: 4,
        identity: {
          firstName: 'Alice',
          lastName: 'Example',
          email: 'alice@example.test',
          phone: '555-0100',
          address1: '1 Main St',
          address2: 'Apt 2',
          address3: 'Building C',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
          country: 'US',
        },
      },
    ]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(skipped).toBe(0);
    expect(items).toEqual([
      {
        type: 'identity',
        firstName: 'Alice',
        lastName: 'Example',
        email: 'alice@example.test',
        phone: '555-0100',
        street: '1 Main St',
        street2: 'Apt 2, Building C',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        country: 'US',
      },
    ]);
  });

  it('skips and counts an SSH key item (type 5), unmapped in this version', () => {
    const raw = exportOf([{ type: 5, name: 'Deploy key' }]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts a login with neither username nor password', () => {
    const raw = exportOf([{ type: 1, name: 'Empty', login: { username: '', password: '' } }]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts a note with no name and no notes', () => {
    const raw = exportOf([{ type: 2 }]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts a card with no number', () => {
    const raw = exportOf([{ type: 3, card: { cardholderName: 'Alice' } }]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('skips and counts an identity with no first or last name', () => {
    const raw = exportOf([{ type: 4, identity: { email: 'alice@example.test' } }]);
    const { items, skipped } = parseBitwardenJson(raw);
    expect(items).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('leaves name out entirely rather than an empty string', () => {
    const raw = exportOf([{ type: 1, login: { username: 'alice', password: 'hunter2' } }]);
    const { items } = parseBitwardenJson(raw);
    expect(items[0]).not.toHaveProperty('name');
  });

  it('throws on something that is not a Bitwarden export', () => {
    expect(() => parseBitwardenJson(JSON.stringify({ vaults: {} }))).toThrow();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseBitwardenJson('not json')).toThrow();
  });
});
