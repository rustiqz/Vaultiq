import { appUrl, matchesApp } from './appLink';

describe('appLink', () => {
  it('builds the androidapp form, and nothing for an unknown package', () => {
    expect(appUrl('com.example.app')).toBe('androidapp://com.example.app');
    expect(appUrl('  ')).toBe('');
  });

  it('matches only the exact package, ignoring case and spaces', () => {
    expect(matchesApp(' AndroidApp://Com.Example.App ', 'com.example.app')).toBe(true);
    expect(matchesApp('androidapp://com.example.other', 'com.example.app')).toBe(false);
    expect(matchesApp('https://example.test', 'com.example.app')).toBe(false);
    expect(matchesApp('androidapp://com.example.app', '')).toBe(false);
  });
});
