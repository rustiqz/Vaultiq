/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo, Text } from 'react-native';
import { IMPORT_STEPS, ProgressBar, ResultBadge, Steps, clampFraction, stepIndex, useReducedMotion } from '../src/ImportVisuals';

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function render(element: React.ReactElement): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  mounted.push(tree);
  return tree;
}

// Animations loop until their tree is gone.
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(tree => tree.unmount());
  });
  jest.restoreAllMocks();
});

describe('clampFraction', () => {
  it('is the share done, between 0 and 1', () => {
    expect(clampFraction(0, 10)).toBe(0);
    expect(clampFraction(5, 10)).toBe(0.5);
    expect(clampFraction(10, 10)).toBe(1);
  });

  it('never leaves the range, whatever it is given', () => {
    expect(clampFraction(15, 10)).toBe(1);
    expect(clampFraction(-3, 10)).toBe(0);
    expect(clampFraction(3, 0)).toBe(0);
    expect(clampFraction(Number.NaN, 10)).toBe(0);
    expect(clampFraction(3, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('stepIndex', () => {
  it('follows the import through its stages', () => {
    expect(stepIndex('pick')).toBe(0);
    expect(stepIndex('preview')).toBe(1);
    expect(stepIndex('importing')).toBe(2);
  });

  it('is past every step once it is done', () => {
    expect(stepIndex('done')).toBe(IMPORT_STEPS.length);
  });
});

describe('Steps', () => {
  it('names every step and says which one this is', async () => {
    const tree = await render(<Steps current={1} />);

    const labels = tree.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
    expect(labels).toEqual(expect.arrayContaining(['Choose', 'Review', 'Import']));
    expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Step 2 of 3').length).toBeGreaterThan(0);
  });

  it('does not claim a step beyond the last once finished', async () => {
    const tree = await render(<Steps current={IMPORT_STEPS.length} />);

    expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Step 3 of 3').length).toBeGreaterThan(0);
  });
});

describe('ProgressBar', () => {
  it('tells a screen reader how far along it is', async () => {
    const tree = await render(<ProgressBar fraction={0.4} label="Import progress" />);

    const bar = tree.root.find(node => node.props.accessibilityRole === 'progressbar');
    expect(bar.props.accessibilityLabel).toBe('Import progress');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 40 });
  });

  it('keeps an out-of-range fraction inside the bar', async () => {
    const tree = await render(<ProgressBar fraction={7} label="p" />);

    expect(tree.root.find(node => node.props.accessibilityRole === 'progressbar').props.accessibilityValue.now).toBe(100);
  });
});

describe('ResultBadge', () => {
  it('renders for a clean finish and for a partial one', async () => {
    await expect(render(<ResultBadge ok />)).resolves.toBeDefined();
    await expect(render(<ResultBadge ok={false} />)).resolves.toBeDefined();
  });
});

describe('useReducedMotion', () => {
  function Probe() {
    return <Text>{useReducedMotion() ? 'reduced' : 'full'}</Text>;
  }

  it('assumes full motion until the device says otherwise', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise(() => {}));

    const tree = await render(<Probe />);

    expect(tree.root.findByType(Text).props.children).toBe('full');
  });

  it('turns motion off when the device asks for less', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(true));

    const tree = await render(<Probe />);

    expect(tree.root.findByType(Text).props.children).toBe('reduced');
  });
});
