/// <reference types="node" />

import fs from 'fs';
import path from 'path';

type OpenButton = {
  tag: string;
  attributes: string;
  bodyStart: number;
  line: number;
  nestedButtons: number;
};

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [fullPath] : [];
  });
}

it('labels every leaf icon-only button', () => {
  const files = [path.join(__dirname, '..', 'App.tsx'), ...sourceFiles(__dirname)];
  const violations: string[] = [];
  let iconOnlyButtons = 0;

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const tags = /<(Pressable|TouchableOpacity)\b((?:=>|[^>])*)>|<\/(Pressable|TouchableOpacity)>/g;
    const stack: OpenButton[] = [];
    let match: RegExpExecArray | null;

    while ((match = tags.exec(source)) !== null) {
      const openingTag = match[1];
      if (openingTag !== undefined) {
        const attributes = match[2] ?? '';
        if (attributes.trimEnd().endsWith('/')) continue;
        if (stack.length > 0) stack[stack.length - 1]!.nestedButtons += 1;
        stack.push({
          tag: openingTag,
          attributes,
          bodyStart: tags.lastIndex,
          line: source.slice(0, match.index).split('\n').length,
          nestedButtons: 0,
        });
        continue;
      }

      const closingTag = match[3];
      const button = stack.pop();
      if (button === undefined || button.tag !== closingTag) {
        throw new Error(`Unbalanced button tags in ${path.relative(path.join(__dirname, '..'), file)}`);
      }
      if (button.nestedButtons > 0) continue;
      const body = source.slice(button.bodyStart, match.index);
      if (body.includes('<Icon') && !body.includes('<Text')) {
        iconOnlyButtons += 1;
        if (!button.attributes.includes('accessibilityLabel')) {
          violations.push(`${path.relative(path.join(__dirname, '..'), file)}:${button.line}`);
        }
      }
    }

    if (stack.length > 0) throw new Error(`Unclosed button tag in ${path.relative(path.join(__dirname, '..'), file)}`);
  }

  expect(iconOnlyButtons).toBeGreaterThanOrEqual(22);
  expect(violations).toEqual([]);
});
