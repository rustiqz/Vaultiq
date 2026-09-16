module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      // @react-native's own jest override only matches *.test.* and
      // __tests__/__mocks__ files, not the setup file Jest itself loads
      // before any test runs.
      files: ['jest.setup.js'],
      env: { jest: true },
    },
  ],
};
