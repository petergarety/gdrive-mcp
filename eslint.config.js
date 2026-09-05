// ESLint flat config — ESLint 9.x + @typescript-eslint 8.x
// Run: npm run lint
import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'coverage/**', '.spare/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        // Cloudflare Workers globals used in src/worker/*
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        RequestInit: 'readonly',
        ResponseInit: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        KVNamespace: 'readonly',
        ExecutionContext: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Project conventions
      'no-unused-vars': 'off', // handled by @typescript-eslint/no-unused-vars
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    // Tests — looser rules
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
