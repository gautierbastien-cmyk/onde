// Génère l'icône (SVG + PNG) et les écrans de lancement iOS, puis les déclare dans index.html.
// Usage : npm run icons
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = 'public/icons';
const splashDir = 'public/splash';
mkdirSync(out, { recursive: true });
mkdirSync(splashDir, { recursive: true });

const cx = 512;
const cy = 512;
const arc = (r, a0, a1) => {
  const rad = (d) => (d * Math.PI) / 180;
  const p = (a) => `${(cx + r * Math.cos(rad(a))).toFixed(1)} ${(cy + r * Math.sin(rad(a))).toFixed(1)}`;
  return `M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`;
};

function iconSvg({ padding = 0, rounded = false } = {}) {
  const s = 1 - padding * 2;
  const waves = [
    [170, 1],
    [278, 0.72],
    [386, 0.42],
  ]
    .map(
      ([r, o]) =>
        `<path d="${arc(r, -38, 38)}" stroke="url(#ember)" stroke-width="58" stroke-linecap="round" fill="none" opacity="${o}"/>` +
        `<path d="${arc(r, 142, 218)}" stroke="url(#ember)" stroke-width="58" stroke-linecap="round" fill="none" opacity="${o}"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1d23"/>
      <stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.55" r="0.55">
      <stop offset="0" stop-color="#ff5a4e" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ff5a4e" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ember" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffa057"/>
      <stop offset="0.5" stop-color="#ff5a52"/>
      <stop offset="1" stop-color="#ff3d6e"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.10"/>
      <stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" ${rounded ? 'rx="230"' : ''} fill="url(#bg)"/>
  <rect width="1024" height="1024" ${rounded ? 'rx="230"' : ''} fill="url(#glow)"/>
  <g transform="translate(${512 - 512 * s} ${512 - 512 * s}) scale(${s})">
    ${waves}
    <circle cx="${cx}" cy="${cy}" r="66" fill="url(#ember)"/>
  </g>
  <rect width="1024" height="1024" ${rounded ? 'rx="230"' : ''} fill="url(#sheen)"/>
</svg>`;
}

const png = (svg, size, file) => sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(file);

writeFileSync(`${out}/icon.svg`, iconSvg({ rounded: true }));
await png(iconSvg(), 180, `${out}/apple-touch-icon.png`);
await png(iconSvg({ rounded: true }), 192, `${out}/icon-192.png`);
await png(iconSvg({ rounded: true }), 512, `${out}/icon-512.png`);
await png(iconSvg({ padding: 0.12 }), 512, `${out}/icon-maskable-512.png`);

// Écrans de lancement : [largeur CSS, hauteur CSS, ratio] des iPhone récents.
const devices = [
  [440, 956, 3], // 16/17 Pro Max
  [402, 874, 3], // 16/17 Pro, 17
  [420, 912, 3], // Air
  [430, 932, 3], // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini (zoom)
  [360, 780, 3], // 12/13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE 2e/3e gén., 8
];

const icon = await sharp(Buffer.from(iconSvg({ rounded: true }))).resize(360, 360).png().toBuffer();
const links = [];
for (const [w, h, r] of devices) {
  const W = w * r;
  const H = h * r;
  const file = `splash/launch-${W}x${H}.png`;
  const size = Math.round(96 * r);
  const logo = await sharp(icon).resize(size, size).toBuffer();
  await sharp({ create: { width: W, height: H, channels: 3, background: '#050506' } })
    .composite([{ input: logo, left: Math.round((W - size) / 2), top: Math.round((H - size) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(`public/${file}`);
  links.push(
    `<link rel="apple-touch-startup-image" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)" href="./${file}" />`,
  );
}

const html = readFileSync('index.html', 'utf8').replace(/<!--SPLASH-->[\s\S]*?(?=\n\s*<\/head>)|<!--SPLASH-->/, `<!--SPLASH-->\n    ${links.join('\n    ')}`);
writeFileSync('index.html', html);
console.log('Icônes et', links.length, 'écrans de lancement générés');
