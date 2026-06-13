import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // R2 (AVATARS) and KV (RATE) bindings come from wrangler.jsonc; no
        // GEMINI_API_KEY is bound, so tests exercise the degrade-to-fallback path.
        wrangler: { configPath: './wrangler.jsonc' },
        // Isolated storage hits a known pool-workers bug popping R2's sqlite-shm
        // frame; our tests use unique rooms/keys, so shared storage is safe.
        isolatedStorage: false,
      },
    },
  },
});
