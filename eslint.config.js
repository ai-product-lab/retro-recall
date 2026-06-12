import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Convention (see docs/ARCHITECTURE.md): deterministic simulation code lives in
// `src/sim/` inside each package and game. The `sim-purity` block below enforces
// the cross-cutting rule that sims never touch DOM, network, timers, wall-clock
// time, or unseeded randomness.

const SIM_FILES = ['packages/*/src/sim/**/*.ts', 'games/*/src/sim/**/*.ts'];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    name: 'sim-purity',
    files: SIM_FILES,
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'navigator',
          'location',
          'history',
          'fetch',
          'XMLHttpRequest',
          'WebSocket',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'setTimeout',
          'setInterval',
          'performance',
          'Audio',
          'Image',
          'Worker',
          'alert',
        ].map((name) => ({
          name,
          message: `Sim code is deterministic and headless — '${name}' is not allowed here.`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/render',
                '**/render/**',
                '**/input',
                '**/input/**',
                '**/net',
                '**/net/**',
                '**/audio',
                '**/audio/**',
                '**/loop',
                '**/loop/**',
              ],
              message:
                'Sim code must not import renderer, input, network, or audio modules.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded RNG owned by the sim instead of Math.random.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Sim time is tick-based — wall-clock time is not allowed.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'Sim time is tick-based — wall-clock time is not allowed.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Sim time is tick-based — wall-clock time is not allowed.',
        },
      ],
    },
  },
);
