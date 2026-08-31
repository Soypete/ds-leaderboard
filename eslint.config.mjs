import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from 'eslint-config-next';
import * as espree from 'espree';

const config = [
  ...nextPlugin,
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
  {
    // eslint-config-next's Babel parser (Next's compiled bundle) returns a
    // scopeManager built on an old eslint-scope API that ESLint 10 rejects.
    // Use the default parser for plain JS config files.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      parser: espree,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    // eslint-plugin-react (via eslint-config-next) calls context.getFilename()
    // while detecting the React version, which ESLint 10 removed. Pin the
    // version explicitly to skip detection.
    settings: {
      react: { version: '19.0' },
    },
  },
];

export default config;