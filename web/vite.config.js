import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // './' = percorsi relativi: funziona su GitHub Pages (/pharmascan/),
  // in locale e su qualsiasi dominio senza modifiche.
  base: './',
  server: {
    host: true,
    // Dev locale trasparente: /api/lookupAic -> function/emulatore, senza CORS.
    // AIFA_FN_URL puo' essere l'URL completo della function (es. emulator
    // http://127.0.0.1:5001/PROGETTO/europe-west1/lookupAic). Se non impostato,
    // usa il default emulator; il rewrite del path mantiene ?aic=.
    proxy: {
      '/api/lookupAic': {
        target: (process.env.AIFA_FN_URL || 'http://127.0.0.1:5001').replace(/\/$/, ''),
        changeOrigin: true,
        rewrite: function (p, req) {
          const base = (process.env.AIFA_FN_URL || '').replace(/\/$/, '');
          // Se AIFA_FN_URL e' gia' l'URL completo della function, inoltra li' con query.
          if (base && /lookupAic/i.test(base)) return base.replace(/^https?:\/\/[^/]+/, '') + (req.url || '');
          return p;
        }
      }
    }
  },
  build: { chunkSizeWarningLimit: 1200, rollupOptions: { output: { manualChunks: function (id) { if (id.includes('@zxing')) return 'zxing'; if (id.includes('firebase') || id.includes('@firebase') || id.includes('idb')) return 'firebase'; } } } },
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    manifest: false,
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      runtimeCaching: [{ urlPattern: /^https:\/\/medicinali\.aifa\.gov\.it\/.*/i, handler: 'NetworkFirst', options: { cacheName: 'aifa' } }]
    }
  })]
});
