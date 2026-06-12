import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'games/*/src/**/*.test.ts',
      'games/*/test/**/*.test.ts',
    ],
  },
});
