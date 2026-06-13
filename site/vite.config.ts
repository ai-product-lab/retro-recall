import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The arcade shell. dist/ holds tsc declarations; the web build goes to
// dist-web/. In production the games' built clients are stitched under /play/*
// alongside this output (ADR-001, Cloudflare Pages).
export default defineConfig({
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
});
