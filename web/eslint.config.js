// @ts-check
import js from '@eslint/js'
import globals from 'globals'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Layer rules from the frontend blueprint (§16). Each entry lists the folders a
 * layer must not import from. Imports are relative, so patterns match any depth.
 * @param {string[]} layers
 */
const forbid = (layers) =>
  layers.map((layer) => ({
    group: [`**/${layer}`, `**/${layer}/**`],
    message: `This layer must not import from src/${layer} (see web/docs/FRONTEND_BLUEPRINT.md §16).`,
  }))

/** @param {string} files @param {string[]} layers @param {string[]} [packages] */
const layer = (files, layers, packages = []) => ({
  files: [files],
  ignores: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: forbid(layers),
        paths: packages.map((name) => ({ name, message: `This layer must not import ${name}.` })),
      },
    ],
  },
})

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts', 'playwright.config.ts', 'eslint.config.js', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  layer('src/contracts/**', ['lib', 'ui', 'stream', 'api', 'state', 'worlds', 'features', 'app'], ['react']),
  layer('src/lib/**', ['contracts', 'ui', 'stream', 'api', 'state', 'worlds', 'features', 'app']),
  layer('src/ui/**', ['contracts', 'stream', 'api', 'state', 'worlds', 'features', 'app']),
  layer('src/stream/**', ['contracts', 'ui', 'api', 'state', 'worlds', 'features', 'app'], ['react']),
  layer('src/api/**', ['ui', 'state', 'worlds', 'features', 'app'], ['react']),
  layer('src/state/**', ['ui', 'worlds', 'features', 'app']),
  layer('src/worlds/**', ['api', 'stream', 'state', 'features', 'app']),
  layer('src/features/**', ['app']),
)
