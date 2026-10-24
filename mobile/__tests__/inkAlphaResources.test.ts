import fs from 'fs';
import path from 'path';

/**
 * `inkAlpha(n)` is a `PlatformColor('@color/vaultiq_ink_alpha_NN')` on Android,
 * so an opacity with no resource crashes the screen that uses it. Jest resolves
 * colours to plain strings and cannot see that, so check the sources directly.
 */
const root = path.join(__dirname, '..');
const res = path.join(root, 'android/app/src/main/res');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function usedSuffixes(): string[] {
  const found = new Set<string>();
  const files = [...walk(path.join(root, 'src')), path.join(root, 'App.tsx')].filter(
    f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/inkAlpha\(\s*([0-9.]+)\s*\)/g)) {
      found.add(String(Math.round(Number(match[1]) * 100)).padStart(2, '0'));
    }
  }
  return [...found].sort();
}

describe('inkAlpha Android resources', () => {
  const used = usedSuffixes();

  it('finds the opacities the app uses', () => {
    expect(used.length).toBeGreaterThan(0);
  });

  for (const folder of ['values', 'values-night']) {
    it(`defines every used opacity in ${folder}/colors.xml`, () => {
      const xml = fs.readFileSync(path.join(res, folder, 'colors.xml'), 'utf8');
      const missing = used.filter(s => !xml.includes(`name="vaultiq_ink_alpha_${s}"`));
      expect(missing).toEqual([]);
    });
  }
});
