import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Tests drive the sim via debugAdvance() for determinism.
          bindings: { DISABLE_AUTO_TICK: '1' },
        },
      },
    },
  },
});
