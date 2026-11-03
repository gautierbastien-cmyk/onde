/** Couleur d'ambiance du lecteur : pochette, sinon logo, sinon teinte dérivée du nom. */
import { useEffect, useState } from 'preact/hooks';
import { colorFromString, extractColor, moodColor, type RGB } from '../../services/artwork/colors';

export function useTint(images: (string | undefined)[], fallbackName: string): RGB {
  const [rgb, setRgb] = useState<RGB>(() => moodColor(colorFromString(fallbackName || 'Onde')));
  const key = images.join('|') + fallbackName;
  useEffect(() => {
    let alive = true;
    const fallback = moodColor(colorFromString(fallbackName || 'Onde'));
    (async () => {
      for (const src of images) {
        if (!src) continue;
        const c = await extractColor(src);
        if (!alive) return;
        if (c) return setRgb(moodColor(c));
      }
      if (alive) setRgb(fallback);
    })();
    return () => {
      alive = false;
    };
  }, [key]);
  return rgb;
}
