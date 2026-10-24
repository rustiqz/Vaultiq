/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import ImportScreen from '../src/screens/ImportScreen';

// Test-only values.
const CSV = [
  'name,url,username,password',
  'One,https://one.test,a@one.test,fixture-pass-1',
  'Two,https://two.test,b@two.test,fixture-pass-2',
].join('\n');

const mockPull = jest.fn((): Promise<unknown[]> => Promise.resolve([]));
const mockAdd = jest.fn((..._args: unknown[]) => Promise.resolve(undefined));
const mockUpdate = jest.fn((..._args: unknown[]) => Promise.resolve(undefined));

// Looked up at call time: these are not initialised yet when the factory is registered.
jest.mock('../src/vault', () => ({
  __esModule: true,
  loadItems: () => mockPull(),
  addItem: (...args: unknown[]) => mockAdd(...args),
  updateItem: (...args: unknown[]) => mockUpdate(...args),
}));

const goBack = jest.fn();
const navigation = { goBack } as never;
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockPull.mockImplementation(() => Promise.resolve([]));
  mockAdd.mockImplementation(() => Promise.resolve(undefined));
  (global as { fetch: unknown }).fetch = jest.fn(() => Promise.resolve({ text: () => Promise.resolve(CSV) }));
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(tree => tree.unmount());
  });
});

const flush = () =>
  ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ImportScreen navigation={navigation} route={{ key: 'k', name: 'Import' } as never} />);
  });
  mounted.push(tree);
  return tree;
}

const label = (node: ReactTestRenderer.ReactTestInstance) => [node.props.children].flat().join('');

function texts(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map(label);
}

/** Presses the button whose text is `title`, then lets everything it started finish. */
async function press(tree: ReactTestRenderer.ReactTestRenderer, title: string): Promise<void> {
  const target = tree.root.findAll(
    node => typeof node.props.onPress === 'function' && node.findAllByType(Text).some(text => label(text) === title),
  )[0];
  if (target === undefined) throw new Error(`no button "${title}" among: ${texts(tree).join(' | ')}`);
  await ReactTestRenderer.act(async () => {
    target.props.onPress();
  });
  for (let tick = 0; tick < 10; tick += 1) await flush();
}

describe('ImportScreen', () => {
  it('starts by asking for a file, and says what it can read', async () => {
    const tree = await render();

    expect(texts(tree)).toEqual(expect.arrayContaining(['Bring your logins over', 'CSV', 'Bitwarden JSON', 'Proton Pass JSON', 'Choose file']));
  });

  it('reads the file and offers what it found for review', async () => {
    const tree = await render();

    await press(tree, 'Choose file');

    expect(texts(tree)).toEqual(expect.arrayContaining(['One', 'Two', 'Import 2', 'Ready to import']));
  });

  it('imports every ticked row and ends on a clean result', async () => {
    const tree = await render();
    await press(tree, 'Choose file');

    await press(tree, 'Import 2');

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(texts(tree)).toEqual(expect.arrayContaining(['All done', 'added', 'Done', 'Import another file']));
    expect(texts(tree)).toContain('Delete the file now. It holds your passwords in plain text.');
  });

  it('says what failed when some rows do not go in, and still finishes', async () => {
    mockAdd.mockImplementationOnce(() => Promise.reject(new Error('version conflict')));
    const tree = await render();
    await press(tree, 'Choose file');

    await press(tree, 'Import 2');

    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(texts(tree)).toEqual(expect.arrayContaining(['Imported, with 1 problem', 'One: version conflict']));
  });

  it('starts a row unticked when the vault already holds exactly that', async () => {
    mockPull.mockImplementation(() =>
      Promise.resolve([
        {
          id: 'existing',
          itemType: 'login',
          version: 1,
          deleted: false,
          content: { type: 'login', name: 'One', username: 'a@one.test', password: 'fixture-pass-1', url: 'https://one.test', notes: '' },
        },
      ]),
    );
    const tree = await render();

    await press(tree, 'Choose file');

    expect(texts(tree)).toContain('Import 1');
    await press(tree, 'Import 1');
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('refuses a file with nothing it recognises, and stays on the first step', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(() => Promise.resolve({ text: () => Promise.resolve('not,a,login,export\n1,2,3,4') }));
    const tree = await render();

    await press(tree, 'Choose file');

    expect(texts(tree).some(text => text.startsWith('Nothing recognisable in that file'))).toBe(true);
    expect(texts(tree)).toContain('Choose file');
  });

  it('lists skipped rows with the reason, on their own tab', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(() =>
      Promise.resolve({
        text: () =>
          Promise.resolve(
            JSON.stringify({
              items: [
                { type: 1, name: 'Fine', login: { username: 'a@one.test', password: 'fixture-pass-1' } },
                { type: 1, name: 'Needs a fix', login: {} },
              ],
            }),
          ),
      }),
    );
    const tree = await render();

    await press(tree, 'Choose file');
    expect(texts(tree)).toContain('Skipped · 1');

    await press(tree, 'Skipped · 1');
    expect(texts(tree)).toEqual(expect.arrayContaining(['Needs a fix', 'No username or password', 'Fix']));
  });

  it('goes back when it is done', async () => {
    const tree = await render();
    await press(tree, 'Choose file');
    await press(tree, 'Import 2');

    await press(tree, 'Done');

    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('can start again from the end', async () => {
    const tree = await render();
    await press(tree, 'Choose file');
    await press(tree, 'Import 2');

    await press(tree, 'Import another file');

    expect(texts(tree)).toContain('Bring your logins over');
  });
});
