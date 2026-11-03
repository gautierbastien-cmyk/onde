import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Génère le Service Worker à la compilation : la liste des fichiers de
 * l'application (precache) et un numéro de version sont injectés dans
 * sw/sw.js. Chaque nouvelle compilation produit donc un nouveau cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'onde-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = [
        'manifest.webmanifest',
        'icons/icon.svg',
        'icons/apple-touch-icon.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
      ];
      const precache = ['./', ...files, ...publicFiles];
      const version = createHash('sha1').update(precache.join('|') + Date.now()).digest('hex').slice(0, 10);
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0') },
  plugins: [preact(), serviceWorker()],
  build: {
    target: 'safari15',
    cssTarget: 'safari15',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
  },
} as any);
