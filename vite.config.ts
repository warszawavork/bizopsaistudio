import 'dotenv/config';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import aiHandler from './api/ai';
import webhookHandler from './api/webhook';
import tilesHandler from './api/tiles';
import statsHandler from './api/stats';

function localApiBridgePlugin(): Plugin {
  return {
    name: 'bizops-local-api-bridge',
    configureServer(server) {
      server.middlewares.use('/api/ai', (req, res) => {
        void aiHandler(req, res);
      });
      server.middlewares.use('/api/webhook', (req, res) => {
        void webhookHandler(req, res);
      });
      server.middlewares.use('/api/tiles', (req, res) => {
        void tilesHandler(req, res);
      });
      server.middlewares.use('/api/stats', (req, res) => {
        void statsHandler(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localApiBridgePlugin()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'pdf-engine': ['jspdf'],
          'icons-vendor': ['lucide-react'],
        },
      },
    },
  },
});
