/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import EmptyState from '../src/EmptyState';

function render(element: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree;
}

function texts(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map(node => [node.props.children].flat().join(''));
}

/** The pressable that contains the given label. */
function button(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  const found = tree.root.findAll(
    node =>
      typeof node.props.onPress === 'function' &&
      node.findAllByType(Text).some(text => [text.props.children].flat().join('') === label),
  );
  return found[0];
}

describe('EmptyState', () => {
  it('says what is missing and what to do about it', () => {
    const tree = render(<EmptyState icon="login" title="No logins yet" hint="Logins you save show up here." />);

    expect(texts(tree)).toEqual(['No logins yet', 'Logins you save show up here.']);
  });

  it('has no button when there is nothing to do', () => {
    const tree = render(<EmptyState icon="trash" title="Trash is empty" hint="Nothing here." />);

    expect(tree.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  it('runs its action when the button is pressed', () => {
    const onAction = jest.fn();
    const tree = render(<EmptyState icon="card" title="No cards yet" hint="h" actionLabel="Add a card" onAction={onAction} />);

    expect(texts(tree)).toContain('Add a card');
    button(tree, 'Add a card').props.onPress();

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('needs both a label and a handler to show a button', () => {
    const labelOnly = render(<EmptyState icon="card" title="t" hint="h" actionLabel="Add a card" />);
    const handlerOnly = render(<EmptyState icon="card" title="t" hint="h" onAction={jest.fn()} />);

    expect(texts(labelOnly)).not.toContain('Add a card');
    expect(handlerOnly.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
  });

  it('shows what was typed as text', () => {
    const tree = render(<EmptyState icon="search" title="No matches" hint="Nothing matches “<b>x</b>”." />);

    expect(texts(tree)).toContain('Nothing matches “<b>x</b>”.');
  });
});
