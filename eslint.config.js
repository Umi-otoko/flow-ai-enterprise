import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // ── Ignored paths ──────────────────────────────────────────────────────────
  {
    ignores: [
      '.wxt/**',
      '.output/**',
      'node_modules/**',
      'postcss.config.js',
      'tailwind.config.ts',
    ],
  },

  // ── JS baseline ────────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript + React ─────────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Browser + WebExtension globals (not importing @types/chrome here
        // because WXT injects them via its own tsconfig)
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        location: 'readonly',
        chrome: 'readonly',
        crypto: 'readonly',
        indexedDB: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        XMLHttpRequest: 'readonly',
        WebSocket: 'readonly',
        MutationObserver: 'readonly',
        HTMLElement: 'readonly',
        HTMLImageElement: 'readonly',
        IDBDatabase: 'readonly',
        IDBOpenDBRequest: 'readonly',
        IDBRequest: 'readonly',
        IDBCursorWithValue: 'readonly',
        InputEvent: 'readonly',
        AbortSignal: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
      },
    },

    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },

    rules: {
      // TypeScript
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // React
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',   // React 17+ JSX transform
      'react/prop-types': 'off',            // TypeScript handles this

      // General
      'no-console': 'off',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },

    settings: {
      react: { version: 'detect' },
    },
  },
];
