import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// WEEVILS_HOST = domaine public (Caddy en HTTPS devant le serveur local) : active le HMR à travers le proxy.
const publicHost = process.env.WEEVILS_HOST

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4178,
    strictPort: true,
    allowedHosts: publicHost ? [publicHost] : [],
    hmr: publicHost ? { protocol: 'wss', host: publicHost, clientPort: 443 } : undefined,
  },
  test: { environment: 'node' },
})
