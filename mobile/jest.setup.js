// Mocks for native modules that aren't linked in Jest's Node environment.
// Nothing here runs a real native binary, so anything that eagerly resolves
// a native module at import time -- rather than lazily, on first call --
// needs a stand-in or the mere act of importing App.tsx throws.

jest.mock('@react-native-clipboard/clipboard', () => ({
  getString: jest.fn(() => Promise.resolve('')),
  setString: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

// Its optional logo-overlay feature pulls in react-native-svg's CSS/LocalSvg
// path, which in turn expects @react-native/assets-registry -- a package
// this project doesn't otherwise depend on and doesn't need, since nothing
// here passes a `logo` prop. Mocked rather than adding a dependency just to
// satisfy an unused code path.
jest.mock('react-native-qrcode-svg', () => () => null);

jest.mock('react-native-vision-camera', () => ({
  Camera: () => null,
  useCameraDevice: jest.fn(() => undefined),
  useCameraPermission: jest.fn(() => ({ hasPermission: false, requestPermission: jest.fn() })),
  useCodeScanner: jest.fn(() => undefined),
}));

// The package ships its own jest mock (jest/build/jest/setup.js), but it
// isn't reachable through its package.json's exports map from outside the
// package -- ERR_PACKAGE_PATH_NOT_EXPORTED. A hand-written stand-in, same as
// the other native modules above.
jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(() => Promise.resolve([{ uri: 'file:///mock/mock.csv', name: 'mock.csv' }])),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
  isErrorWithCode: jest.fn(() => false),
}));
