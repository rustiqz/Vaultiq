// A minimal `browser` global.
//
// Only the surfaces the background context actually touches: session storage
// and alarms. Anything else is deliberately absent, so a test that reaches
// for a new API fails loudly rather than silently doing nothing.

import { beforeEach, vi } from "vitest";

const session = new Map<string, unknown>();
const local = new Map<string, unknown>();

/** The page a test pretends the user is looking at. */
export const activeTab: { url: string | undefined } = { url: undefined };

const browserStub = {
  storage: {
    // Where the device identity lives: it has to survive the browser closing,
    // which session storage deliberately does not.
    local: {
      get: vi.fn((key: string) =>
        Promise.resolve(local.has(key) ? { [key]: local.get(key) } : {}),
      ),
      set: vi.fn((entries: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(entries)) local.set(key, value);
        return Promise.resolve();
      }),
    },
    session: {
      get: vi.fn((key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        const found: Record<string, unknown> = {};
        for (const one of keys) if (session.has(one)) found[one] = session.get(one);
        return Promise.resolve(found);
      }),
      set: vi.fn((entries: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(entries)) session.set(key, value);
        return Promise.resolve();
      }),
      remove: vi.fn((key: string | string[]) => {
        for (const one of Array.isArray(key) ? key : [key]) session.delete(one);
        return Promise.resolve();
      }),
    },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(() => Promise.resolve(true)),
    onAlarm: { addListener: vi.fn() },
  },
  tabs: {
    // Mirrors the real API: a query only answers when the window filter it
    // uses can be satisfied. `lastFocusedWindow` is the one that works from a
    // background page; `currentWindow` is not, which was the bug.
    query: vi.fn((filter: { lastFocusedWindow?: boolean; currentWindow?: boolean }) =>
      Promise.resolve(
        filter.lastFocusedWindow === true && activeTab.url !== undefined
          ? [{ url: activeTab.url }]
          : [],
      ),
    ),
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
  local.clear();
  activeTab.url = undefined;
  vi.clearAllMocks();
});
