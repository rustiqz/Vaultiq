import AsyncStorage from '@react-native-async-storage/async-storage';
import {readAutoLockMinutes, subscribeAutoLockMinutes, writeAutoLockMinutes} from './storage';

describe('auto-lock settings', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('uses the default and reads written values', async () => {
    expect(await readAutoLockMinutes()).toBe(15);
    await writeAutoLockMinutes(5);
    expect(await readAutoLockMinutes()).toBe(5);
  });

  it('notifies a subscriber once per successful write and stops after unsubscribe', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeAutoLockMinutes(listener);
    try {
      expect(listener).not.toHaveBeenCalled();
      await writeAutoLockMinutes(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(1);
      unsubscribe();
      unsubscribe();
      await writeAutoLockMinutes(5);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('notifies the other listeners even if one throws', async () => {
    const first = jest.fn(() => { throw new Error('fake listener error'); });
    const second = jest.fn();
    const unsubscribeFirst = subscribeAutoLockMinutes(first);
    const unsubscribeSecond = subscribeAutoLockMinutes(second);
    try {
      await expect(writeAutoLockMinutes(1)).resolves.toBeUndefined();
      expect(first).toHaveBeenCalledWith(1);
      expect(second).toHaveBeenCalledWith(1);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });

  it('does not notify when persistence fails', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeAutoLockMinutes(listener);
    const failure = new Error('fake storage failure');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(failure);
    try {
      await expect(writeAutoLockMinutes(1)).rejects.toBe(failure);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
      jest.restoreAllMocks();
    }
  });
});
