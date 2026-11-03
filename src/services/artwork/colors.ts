/**
 * Couleur dominante d'une image (pochette ou logo) pour teinter le lecteur.
 * Nécessite une image servie avec CORS ; sinon, couleur dérivée du nom.
 */
import { hash } from '../m3u/normalize';

export type RGB = [number, number, number];

const cache = new Map<string, Promise<RGB | null>>();

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Teinte élégante et stable, dérivée d'un texte. */
export function colorFromString(s: string): RGB {
  const h = parseInt(hash(s), 36) % 360;
  return hslToRgb(h, 0.55, 0.42);
}

export function extractColor(src: string): Promise<RGB | null> {
  if (cache.has(src)) return cache.get(src)!;
  const p = new Promise<RGB | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        // Moyenne pondérée par la saturation : on privilégie les couleurs vives.
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = max / 255;
          const weight = 0.05 + sat * sat * (lum > 0.12 && lum < 0.96 ? 1 : 0.1);
          r += d[i] * weight;
          g += d[i + 1] * weight;
          b += d[i + 2] * weight;
          w += weight;
        }
        resolve(w ? [r / w, g / w, b / w].map(Math.round) as RGB : null);
      } catch {
        resolve(null); // image « tainted » (pas de CORS)
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

/** Ajuste une couleur pour un fond sombre : ni trop claire, ni grise. */
export function moodColor([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (max === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return hslToRgb(h, Math.min(0.75, Math.max(0.28, s)), Math.min(0.48, Math.max(0.3, l)));
}
