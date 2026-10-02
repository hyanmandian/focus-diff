import { defineConfig } from 'vite-plus';

const EXTENSION_GLOBALS = {
  FocusDiff: 'readonly',
  FocusDiffAI: 'readonly',
  FocusDiffGuide: 'readonly',
  FocusDiffGuidePanel: 'readonly',
  FocusDiffPanel: 'readonly',
  FocusDiffPage: 'readonly',
  FocusDiffRecipes: 'readonly',
  GitHubPage: 'readonly',
};

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  lint: {
    ignorePatterns: ['dist/**', 'node_modules/**'],
    categories: { correctness: 'error' },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', args: 'after-used', caughtErrors: 'none', ignoreRestSiblings: true }],
    },
    overrides: [
      {
        files: ['src/**/*.js'],
        env: { browser: true, webextensions: true },
        globals: EXTENSION_GLOBALS,
      },
      {
        files: ['tests/**', 'scripts/**', 'vite.config.js'],
        env: { node: true },
      },
    ],
  },
  fmt: {
    ignorePatterns: ['dist/**', 'store/**', 'package-lock.json'],
    singleQuote: true,
    printWidth: 140,
    sortPackageJson: true,
  },
});
