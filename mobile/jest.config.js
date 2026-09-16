module.exports = {
  preset: '@react-native/jest-preset',
  // A config key present in both the preset and here overrides rather than
  // merges, so the preset's own setup (Animated, core native-module stubs)
  // has to be re-listed explicitly alongside this project's.
  setupFiles: [
    require.resolve('@react-native/jest-preset/jest/setup.js'),
    './jest.setup.js',
  ],
  // The preset's own transformIgnorePatterns only lets react-native and
  // @react-native(-community) packages through Babel -- every other
  // RN-ecosystem dependency here ships at least one ESM entry point Jest
  // can't parse untransformed (@react-navigation/native's own module build
  // is what App.test.tsx hits first). Widened to name them explicitly
  // rather than opening transforms to all of node_modules.
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      [
        '(jest-)?react-native',
        '@react-native(-community)?',
        '@react-native-async-storage',
        '@react-native-clipboard',
        '@react-native-vector-icons',
        '@react-navigation',
        'react-native-.*',
      ].join('|') +
      ')/)',
  ],
};
