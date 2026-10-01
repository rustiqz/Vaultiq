import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {BackHandler} from 'react-native';
import {useHardwareBack} from './useHardwareBack';

function Harness({handler}: {handler: () => boolean}) {
  useHardwareBack(handler);
  return null;
}

it('uses the latest handler in one subscription and removes it on unmount', async () => {
  const remove = jest.fn();
  let press: (() => boolean | undefined) | undefined;
  const add = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, callback) => {
    press = () => callback({} as Parameters<typeof callback>[0]);
    return {remove};
  });
  const first = jest.fn(() => true);
  const second = jest.fn(() => false);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  try {
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<Harness handler={first} />);
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    expect(press?.()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(() => {
      renderer.update(<Harness handler={second} />);
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(press?.()).toBe(false);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(() => renderer.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  } finally {
    add.mockRestore();
  }
});
