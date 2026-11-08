import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Hands-free voice runs Silero VAD in the browser. Its model, audio worklet and the ONNX runtime are served
// from our own origin at /vad/ (no CDN): straight from node_modules in dev, emitted as assets in the build.
function vadAssets(): Plugin {
  const files: Record<string, string> = {
    'vad.worklet.bundle.min.js': '@ricky0123/vad-web/dist',
    'silero_vad_v5.onnx': '@ricky0123/vad-web/dist',
    'ort-wasm-simd-threaded.mjs': 'onnxruntime-web/dist',
    'ort-wasm-simd-threaded.wasm': 'onnxruntime-web/dist',
  }
  const read = (name: string) => readFileSync(resolve(import.meta.dirname, 'node_modules', files[name], name))
  const types: Record<string, string> = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm' }
  return {
    name: 'vad-assets',
    configureServer(server) {
      // Ahead of Vite's own middleware, which rejects the `?import` it appends to ORT's dynamic import.
      server.middlewares.use('/vad/', (req, res, next) => {
        const name = req.url!.slice(1).split('?')[0]
        if (!(name in files)) return next()
        res.setHeader('Content-Type', types[name.split('.').pop()!] ?? 'application/octet-stream')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of Object.keys(files)) this.emitFile({ type: 'asset', fileName: `vad/${name}`, source: read(name) })
    },
  }
}

export default defineConfig({
  plugins: [
    vadAssets(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Minerva',
        short_name: 'Minerva',
        description: 'Learn complex topics deeply',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        maximumFileSizeToCacheInBytes: 8_000_000,
        globIgnores: ['vad/**'], // ~16 MB, fetched only when hands-free talk starts
      },
    }),
  ],
  server: {
    host: true,
    proxy: { '/api': 'http://127.0.0.1:8765' },
    fs: { allow: ['..'] }, // shared/widgets catalog lives outside frontend/
  },
})
