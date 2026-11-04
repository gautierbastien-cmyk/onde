// Génère l'icône tvOS (couches Back/Front pour la parallaxe) et les images Top Shelf.
// Usage (depuis onde/) : node tvos/generate-assets.mjs
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';

const root = 'tvos/OndeTV/Assets.xcassets';
const brand = `${root}/App Icon & Top Shelf Image.brandassets`;
const info = { info: { author: 'xcode', version: 1 } };
const json = (p, o) => writeFileSync(p, JSON.stringify({ ...o, ...info }, null, 2));

const back = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d1d23"/><stop offset="1" stop-color="#050506"/></linearGradient>
  <radialGradient id="g" cx="0.5" cy="0.55" r="0.6"><stop offset="0" stop-color="#ff5a4e" stop-opacity="0.38"/><stop offset="1" stop-color="#ff5a4e" stop-opacity="0"/></radialGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;

const waves = (w, h, scale = 1, withText = false) => {
  const cx = w / 2, cy = h / 2, u = h / 1024 * scale;
  const arc = (r, a0, a1) => {
    const p = (a) => `${(cx + r * u * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(cy + r * u * Math.sin(a * Math.PI / 180)).toFixed(1)}`;
    return `M ${p(a0)} A ${r * u} ${r * u} 0 0 1 ${p(a1)}`;
  };
  const strokes = [[170, 1], [278, 0.72], [386, 0.42]].map(([r, o]) =>
    `<path d="${arc(r, -38, 38)}" stroke="url(#e)" stroke-width="${58 * u}" stroke-linecap="round" fill="none" opacity="${o}"/>` +
    `<path d="${arc(r, 142, 218)}" stroke="url(#e)" stroke-width="${58 * u}" stroke-linecap="round" fill="none" opacity="${o}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffa057"/><stop offset="0.5" stop-color="#ff5a52"/><stop offset="1" stop-color="#ff3d6e"/></linearGradient></defs>
  ${strokes}<circle cx="${cx}" cy="${cy}" r="${66 * u}" fill="url(#e)"/>
  ${withText ? `<text x="${cx}" y="${cy + 520 * u}" font-family="Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="${150 * u}" fill="#f5f5f7" text-anchor="middle">Onde</text>` : ''}</svg>`;
};

async function png(svg, file) { await sharp(Buffer.from(svg)).png().toFile(file); }

async function stack(name, sizes) {
  const dir = `${brand}/${name}.imagestack`;
  mkdirSync(dir, { recursive: true });
  json(`${dir}/Contents.json`, { layers: [{ filename: 'Front.imagestacklayer' }, { filename: 'Back.imagestacklayer' }] });
  for (const [layer, make] of [['Front', (w, h) => waves(w, h, 0.62)], ['Back', back]]) {
    const ld = `${dir}/${layer}.imagestacklayer`;
    const set = `${ld}/Content.imageset`;
    mkdirSync(set, { recursive: true });
    json(`${ld}/Contents.json`, {});
    const images = [];
    for (const [w, h, scale] of sizes) {
      const f = `${layer.toLowerCase()}-${w}x${h}.png`;
      await png(make(w, h), `${set}/${f}`);
      images.push({ filename: f, idiom: 'tv', scale });
    }
    json(`${set}/Contents.json`, { images });
  }
}

async function shelf(name, sizes) {
  const set = `${brand}/${name}.imageset`;
  mkdirSync(set, { recursive: true });
  const images = [];
  for (const [w, h, scale] of sizes) {
    const f = `shelf-${w}x${h}.png`;
    const composite = await sharp(Buffer.from(back(w, h))).composite([{ input: Buffer.from(waves(w, h, 0.5, false)) }]).png().toBuffer();
    await sharp(composite).toFile(`${set}/${f}`);
    images.push({ filename: f, idiom: 'tv', scale });
  }
  json(`${set}/Contents.json`, { images });
}

mkdirSync(brand, { recursive: true });
json(`${root}/Contents.json`, {});
json(`${brand}/Contents.json`, {
  assets: [
    { filename: 'App Icon - App Store.imagestack', idiom: 'tv', role: 'primary-app-icon', size: '1280x768' },
    { filename: 'App Icon.imagestack', idiom: 'tv', role: 'primary-app-icon', size: '400x240' },
    { filename: 'Top Shelf Image Wide.imageset', idiom: 'tv', role: 'top-shelf-image-wide', size: '2320x720' },
    { filename: 'Top Shelf Image.imageset', idiom: 'tv', role: 'top-shelf-image', size: '1920x720' },
  ],
});
await stack('App Icon', [[400, 240, '1x'], [800, 480, '2x']]);
await stack('App Icon - App Store', [[1280, 768, '1x']]);
await shelf('Top Shelf Image', [[1920, 720, '1x'], [3840, 1440, '2x']]);
await shelf('Top Shelf Image Wide', [[2320, 720, '1x'], [4640, 1440, '2x']]);
console.log('Icône et Top Shelf générés');
