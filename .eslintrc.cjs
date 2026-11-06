/* Shared ESLint config for the workspace. */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: [
    'node_modules',
    'dist',
    'spike',
    '**/*.config.ts',
    '**/*.config.js',
    'playwright-report',
    'test-results',
  ],
  rules: {},
};
