// A minimal `browser` global.
//
// Only the surfaces the background context actually touches: session storage
// and alarms. Anything else is deliberately absent, so a test that reaches
// for a new API fails loudly rather than silently doing nothing.

import { beforeEach, vi } from "vitest";

const session = new Map<string, unknown>();

const browserStub = {
  storage: {
    session: {
      get: vi.fn((key: string) =>
        Promise.resolve(session.has(key) ? { [key]: session.get(key) } : {}),
      ),
      set: vi.fn((entries: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(entries)) session.set(key, value);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string) => {
        session.delete(key);
        return Promise.resolve();
      }),
    },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(() => Promise.resolve(true)),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    getURL: vi.fn((path: string) => `moz-extension://test/${path}`),
    onMessage: { addListener: vi.fn() },
  },
};

Object.assign(globalThis, { browser: browserStub });

/** Lets a test assert what is, and is not, in session storage. */
export const sessionStore = session;

beforeEach(() => {
  session.clear();
  vi.clearAllMocks();
});
