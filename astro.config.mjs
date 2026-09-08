// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

/**
 * Static output, deliberately.
 *
 * Invariant A: an ordinary Learn, cheatsheet, or Trial read must not require a
 * database or an API request. `output: 'static'` is how that is enforced by the
 * build rather than by good intentions - there is no server to accidentally
 * depend on.
 *
 * React is present for islands only. Pages that are not interactive ship no
 * JavaScript at all.
 */
export default defineConfig({
  site: 'https://rustly.tech',
  output: 'static',
  integrations: [react(), sitemap()],
  build: {
    // One stylesheet, so a lesson page is one HTML request and one CSS request.
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      // Monaco is large and lazily loaded. Keeping it in its own chunk means a
      // reader who never opens the editor never downloads it.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('monaco-editor')) return 'monaco';
            return undefined;
          },
        },
      },
    },
  },
});
