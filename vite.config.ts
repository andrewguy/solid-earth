import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * GitHub Pages serves the site from /<repo>/, so production builds use that as the base path.
 * Override with BASE_PATH (e.g. BASE_PATH=/ for a custom domain or another host).
 */
const PAGES_BASE = '/solid-earth/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BASE_PATH ?? PAGES_BASE) : '/',
  plugins: [react(), tailwindcss()],
  // ES-module workers can code-split, so each data resolution loads as its own chunk.
  worker: { format: 'es' },
  build: {
    // The lazily loaded 3D view is ~900 kB, nearly all three.js; the main bundle stays small.
    chunkSizeWarningLimit: 1000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
}))
