// weevils next: a separate front-end, built on its own (never part of the main app's build or dist/).
// It talks to the same weevilsd API (/api) from its own address, so it shares no UI code it could break.
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  plugins: [react()],
  publicDir: path.join(import.meta.dirname, '..', 'public'),
  build: { outDir: path.join(import.meta.dirname, 'dist'), emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { host: '127.0.0.1', port: 4183, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4179', ws: true } } },
})
