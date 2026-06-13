import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// dist/ holds tsc declarations; the web build goes to dist-web/. Two entries:
// the solo-practice home and the /play/puck-pals/ route the rooms server links to.
export default defineConfig({
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        play: fileURLToPath(new URL('./play/puck-pals/index.html', import.meta.url)),
      },
    },
  },
});
