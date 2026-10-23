import type { ItemContent } from '../itemContent';
import { type ImportProgress, type ImportRow, runImport } from './importRun';

// Test-only values.
const login = (name: string): ItemContent => ({ type: 'login', name, username: `${name}@example.test`, password: 'fixture-pass', url: '', notes: '' });

const row = (name: string, extra: Partial<ImportRow> = {}): ImportRow => ({
  item: login(name),
  included: true,
  match: null,
  replace: false,
  ...extra,
});

function operations() {
  return {
    add: jest.fn(() => Promise.resolve(undefined)),
    update: jest.fn(() => Promise.resolve(undefined)),
  };
}

describe('runImport', () => {
  it('adds every ticked row', async () => {
    const ops = operations();

    const outcome = await runImport([row('a'), row('b')], ops);

    expect(ops.add).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ added: 2, replaced: 0, failures: [] });
  });

  it('leaves out a row that is not ticked', async () => {
    const ops = operations();

    const outcome = await runImport([row('a'), row('b', { included: false })], ops);

    expect(ops.add).toHaveBeenCalledTimes(1);
    expect(outcome.added).toBe(1);
  });

  it('replaces the matched item when asked to, and adds when only matched', async () => {
    const ops = operations();
    const match = { id: 'existing-1', version: 4, label: 'Old', identical: false };

    const outcome = await runImport([row('replace me', { match, replace: true }), row('keep both', { match, replace: false })], ops);

    expect(ops.update).toHaveBeenCalledWith('existing-1', 4, expect.objectContaining({ name: 'replace me' }));
    expect(ops.add).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ added: 1, replaced: 1, failures: [] });
  });

  it('carries on after a row fails, and says which one', async () => {
    const ops = operations();
    ops.add.mockImplementationOnce(() => Promise.reject(new Error('version conflict')));

    const outcome = await runImport([row('first'), row('second'), row('third')], ops);

    expect(ops.add).toHaveBeenCalledTimes(3);
    expect(outcome.added).toBe(2);
    expect(outcome.failures).toEqual([{ name: 'first', message: 'version conflict' }]);
  });

  it('reports progress before and after each row, counting only ticked ones', async () => {
    const seen: ImportProgress[] = [];

    await runImport([row('a'), row('skipped', { included: false }), row('b')], operations(), progress => seen.push(progress));

    expect(seen).toEqual([
      { done: 0, total: 2, current: 'a' },
      { done: 1, total: 2, current: 'a' },
      { done: 1, total: 2, current: 'b' },
      { done: 2, total: 2, current: 'b' },
    ]);
  });

  it('still counts a failed row as finished', async () => {
    const ops = operations();
    ops.add.mockImplementation(() => Promise.reject(new Error('nope')));
    const seen: ImportProgress[] = [];

    await runImport([row('a'), row('b')], ops, progress => seen.push(progress));

    expect(seen.at(-1)).toEqual({ done: 2, total: 2, current: 'b' });
  });

  it('does nothing, and reports nothing, for an empty import', async () => {
    const ops = operations();
    const seen: ImportProgress[] = [];

    const outcome = await runImport([row('a', { included: false })], ops, progress => seen.push(progress));

    expect(outcome).toEqual({ added: 0, replaced: 0, failures: [] });
    expect(seen).toEqual([]);
  });

  it('runs one row at a time, in order', async () => {
    const order: string[] = [];
    const ops = {
      add: jest.fn(async (item: ItemContent) => {
        order.push(`start ${String(item.name)}`);
        await Promise.resolve();
        order.push(`end ${String(item.name)}`);
      }),
      update: jest.fn(() => Promise.resolve(undefined)),
    };

    await runImport([row('a'), row('b')], ops);

    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
