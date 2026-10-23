/**
 * @format
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import GeneratorScreen from '../src/screens/GeneratorScreen';

// Test-only values.
const PASSWORD = 'Xk9!mQ2#vLp7wRz';
const PASSPHRASE = 'correct-horse-battery-staple-orbit-lantern';

const mockCore = {
  generatePassword: jest.fn(() => Promise.resolve(PASSWORD)),
  generatePassphrase: jest.fn(() => Promise.resolve(PASSPHRASE)),
  passphraseBits: jest.fn(() => Promise.resolve(77)),
  estimateStrength: jest.fn(() => Promise.resolve({ bits: 131, level: 'Excellent' })),
};

// The bridge module reads NativeModules when it is first imported, so the
// stand-in has to replace the module itself. Looked up at call time, because
// `mockCore` is not initialised yet when this factory is registered.
jest.mock('../src/nativeCryptoCore', () => ({
  __esModule: true,
  default: new Proxy({}, { get: (_target, name: string) => (mockCore as Record<string, unknown>)[name] }),
}));

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  // The screen remembers its settings; one test's choice must not be the next one's start.
  await AsyncStorage.clear();
});

// A tree left mounted keeps reacting, and would call the shared stand-in
// during some later test.
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(tree => tree.unmount());
  });
});

/** Lets the chain of awaits inside one generation (make, then rate) finish. */
async function settle(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  });
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<GeneratorScreen />);
  });
  mounted.push(tree);
  // Until the first password has been made and rated, however many ticks that takes.
  for (let tick = 0; tick < 20 && !texts(tree).includes('Excellent · ~131 bits'); tick += 1) {
    await settle();
  }
  return tree;
}

/** The tab that is not showing. Found by what it says it is, not by its component. */
function inactiveTab(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.find(
    node =>
      node.props.accessibilityRole === 'tab' &&
      node.props.accessibilityState?.selected === false &&
      typeof node.props.onPress === 'function',
  );
}

function texts(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
}

describe('GeneratorScreen', () => {
  it('makes a password with the default settings and rates it', async () => {
    const tree = await render();

    expect(mockCore.generatePassword).toHaveBeenCalledWith(
      expect.objectContaining({ length: 20, lowercase: true, uppercase: true, digits: true, symbols: true, avoidAmbiguous: false }),
    );
    expect(texts(tree)).toContain(PASSWORD);
    expect(texts(tree)).toContain('Excellent · ~131 bits');
  });

  it('switches to a passphrase and reports the bits it was drawn with', async () => {
    const tree = await render();
    const tab = inactiveTab(tree);

    await ReactTestRenderer.act(async () => {
      tab.props.onPress();
    });
    await settle();

    expect(mockCore.generatePassphrase).toHaveBeenCalledWith(
      expect.objectContaining({ words: 6, separator: '-', capitalize: false, includeNumber: false }),
    );
    expect(texts(tree)).toContain(PASSPHRASE);
    expect(texts(tree)).toContain('~77 bits · 6 words');
  });

  it('does not score a passphrase from its text', async () => {
    const tree = await render();
    mockCore.estimateStrength.mockClear();
    mockCore.generatePassword.mockClear();
    const tab = inactiveTab(tree);

    await ReactTestRenderer.act(async () => {
      tab.props.onPress();
    });
    await settle();

    expect(mockCore.estimateStrength).not.toHaveBeenCalled();
  });

  it('shows the core refusing, rather than a stale or empty password', async () => {
    mockCore.generatePassword.mockImplementationOnce(() => Promise.reject(new Error('invalid options: nothing to draw from')));

    const tree = await render();

    expect(texts(tree)).toContain('invalid options: nothing to draw from');
  });
});
