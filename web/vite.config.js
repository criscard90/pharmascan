import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // './' = percorsi relativi: funziona su GitHub Pages (/pharmascan/),
  // in locale e su qualsiasi dominio senza modifiche.
  base: './',
  server: { host: true },
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
