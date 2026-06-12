import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// dist/ belongs to tsc declarations; the web build goes to dist-web/.
export default defineConfig({
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/bubble-buddies/index.html', import.meta.url)),
      },
    },
  },
});
