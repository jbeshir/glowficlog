// ESLint flat config (ESLint 9 + typescript-eslint 8).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'fixtures/**',
      'web-ext-artifacts/**',
      'src/dev/fixtures.generated.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mjs'],
    rules: {
      // The TypeScript compiler already resolves identifiers; no-undef would
      // false-positive on DOM/WebExtension globals that vary per environment.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    // Build/packaging scripts are Node ESM modules.
    files: ['scripts/**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
