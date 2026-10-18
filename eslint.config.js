import js from '@eslint/js';
import globals from 'globals';

/**
 * Configuration ESLint (format « flat »).
 *
 * Périmètre : l'application (navigateur et service worker) et les tests
 * (Node). Les scripts Python de tools/ sont couverts par Ruff, pas ici.
 */
export default [
  {
    ignores: ['node_modules/**', 'tools/.pdf-cache/**', 'data/**'],
  },
  js.configs.recommended,
  {
    files: ['assets/js/**/*.js', 'service-worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
