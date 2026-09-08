// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';

export default tseslint.config(
  { ignores: ['dist/**', '.astro/**', 'node_modules/**', 'src/data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      // `any` defeats the point of strict mode. Where it is genuinely needed,
      // the disable comment forces a sentence explaining why.
      '@typescript-eslint/no-explicit-any': 'error',
      // A leading underscore marks a parameter kept for interface conformance.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Build scripts run in Node, not in a browser.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
);
