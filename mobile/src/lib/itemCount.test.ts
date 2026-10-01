import {countLogins, countUserItems} from './itemCount';

const items = [
  {itemType: 'login', deleted: false},
  {itemType: 'note', deleted: false},
  {itemType: 'card', deleted: false},
  {itemType: 'identity', deleted: false},
  {itemType: 'totp', deleted: false},
  {itemType: 'usage', deleted: false},
  {itemType: 'login', deleted: true},
  {itemType: 'note', deleted: true},
];

describe('item counts', () => {
  it('counts all five live user types and excludes internal and trashed records', () => {
    expect(countUserItems(items)).toBe(5);
  });

  it('counts only live logins', () => {
    expect(countLogins(items)).toBe(1);
  });

  it('returns zero for an empty list', () => {
    expect(countUserItems([])).toBe(0);
    expect(countLogins([])).toBe(0);
  });
});
