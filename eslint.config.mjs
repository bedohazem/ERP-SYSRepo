import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'tools/release/**',
      '.acceptance-data/**',
    ],
  },

  {
    files: ['**/*.{js,mjs,cjs}'],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },

    rules: {
      ...js.configs.recommended.rules,

      'no-console': 'off',

      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },

  {
    files: ['**/*.cjs'],

    languageOptions: {
      sourceType: 'commonjs',
    },
  },

  {
    files: ['**/*.{ts,tsx}'],

    languageOptions: {
      parser: tseslint.parser,

      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',

        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },

    rules: {
      ...js.configs.recommended.rules,

      /*
       * TypeScript مسؤول عن تعريف
       * globals والـtypes.
       */
      'no-undef': 'off',

      /*
       * القواعد الأصلية قد تعطي
       * false positives مع TypeScript.
       */
      'no-redeclare': 'off',
      'no-dupe-class-members': 'off',
      'no-unused-vars': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      'no-console': 'off',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],

    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },

    rules: {
      'react-hooks/rules-of-hooks': 'error',

      'react-hooks/exhaustive-deps': 'warn',

      'react-refresh/only-export-components': 'warn',
    },
  },

  {
    files: ['tools/support-generator/renderer.js'],

    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  eslintConfigPrettier,
];
