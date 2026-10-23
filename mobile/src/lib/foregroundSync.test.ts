import { DEFAULT_INTERVAL_MS, DEFAULT_MIN_GAP_MS, startForegroundSync } from './foregroundSync';
import { announceRemoteChange, onRemoteChange } from './remoteChange';

/** A stand-in for the app coming to the front, and the clock. */
function harness(overrides: { catchUp?: () => Promise<boolean>; active?: boolean } = {}) {
  let active = overrides.active ?? true;
  let onActive: () => void = () => {};
  let unsubscribed = false;
  const catchUp = jest.fn(overrides.catchUp ?? (() => Promise.resolve(true)));
  const announce = jest.fn();

  const stop = startForegroundSync({
    catchUp,
    announce,
    isActive: () => active,
    subscribeActive: callback => {
      onActive = callback;
      return () => {
        unsubscribed = true;
      };
    },
    now: () => Date.now(),
  });

  return {
    catchUp,
    announce,
    stop,
    comeToFront: () => onActive(),
    setActive: (value: boolean) => {
      active = value;
    },
    unsubscribed: () => unsubscribed,
  };
}

/** Lets a lookup that was started run to its end. */
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('startForegroundSync', () => {
  it('looks when the app returns to the front, and says so when something arrived', async () => {
    const sync = harness();

    sync.comeToFront();
    await settle();

    expect(sync.catchUp).toHaveBeenCalledTimes(1);
    expect(sync.announce).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when nothing new arrived', async () => {
    const sync = harness({ catchUp: () => Promise.resolve(false) });

    sync.comeToFront();
    await settle();

    expect(sync.catchUp).toHaveBeenCalledTimes(1);
    expect(sync.announce).not.toHaveBeenCalled();
  });

  it('looks again every interval while the app stays in front', async () => {
    const sync = harness();

    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS);
    await settle();
    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS);
    await settle();

    expect(sync.catchUp).toHaveBeenCalledTimes(2);
  });

  it('does not look on the timer while the app is not in front', async () => {
    const sync = harness({ active: false });

    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS * 3);
    await settle();

    expect(sync.catchUp).not.toHaveBeenCalled();
  });

  it('does not look twice within the minimum gap, however it was triggered', async () => {
    const sync = harness();

    sync.comeToFront();
    await settle();
    sync.comeToFront();
    await settle();
    expect(sync.catchUp).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(DEFAULT_MIN_GAP_MS);
    sync.comeToFront();
    await settle();
    expect(sync.catchUp).toHaveBeenCalledTimes(2);
  });

  it('does not start a second lookup while one is running', async () => {
    let release: (arrived: boolean) => void = () => {};
    const sync = harness({ catchUp: () => new Promise<boolean>(resolve => (release = resolve)) });

    sync.comeToFront();
    jest.advanceTimersByTime(DEFAULT_MIN_GAP_MS * 2);
    sync.comeToFront();
    expect(sync.catchUp).toHaveBeenCalledTimes(1);

    release(true);
    await settle();
    expect(sync.announce).toHaveBeenCalledTimes(1);
  });

  it('survives a failed lookup and tries again later', async () => {
    const catchUp = jest
      .fn<Promise<boolean>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(true);
    const sync = harness({ catchUp });

    sync.comeToFront();
    await settle();
    expect(sync.announce).not.toHaveBeenCalled();

    jest.advanceTimersByTime(DEFAULT_MIN_GAP_MS);
    sync.comeToFront();
    await settle();
    expect(sync.announce).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failing lookup in a tight loop', async () => {
    const sync = harness({ catchUp: () => Promise.reject(new Error('down')) });

    sync.comeToFront();
    await settle();
    sync.comeToFront();
    await settle();

    expect(sync.catchUp).toHaveBeenCalledTimes(1);
  });

  it('stops: no timer, no listening, and no announcement from one still in flight', async () => {
    let release: (arrived: boolean) => void = () => {};
    const sync = harness({ catchUp: () => new Promise<boolean>(resolve => (release = resolve)) });
    sync.comeToFront();

    sync.stop();
    release(true);
    await settle();
    jest.advanceTimersByTime(DEFAULT_INTERVAL_MS * 2);
    await settle();

    expect(sync.unsubscribed()).toBe(true);
    expect(sync.announce).not.toHaveBeenCalled();
    expect(sync.catchUp).toHaveBeenCalledTimes(1);
  });
});

describe('remote change signal', () => {
  it('tells every subscriber, and stops telling one that unsubscribed', () => {
    const first = jest.fn();
    const second = jest.fn();
    const stopFirst = onRemoteChange(first);
    const stopSecond = onRemoteChange(second);

    announceRemoteChange();
    stopFirst();
    announceRemoteChange();
    stopSecond();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('keeps telling the rest when one subscriber throws', () => {
    const broken = jest.fn(() => {
      throw new Error('screen is gone');
    });
    const fine = jest.fn();
    const stops = [onRemoteChange(broken), onRemoteChange(fine)];

    expect(() => announceRemoteChange()).not.toThrow();
    stops.forEach(stop => stop());

    expect(fine).toHaveBeenCalledTimes(1);
  });
});
