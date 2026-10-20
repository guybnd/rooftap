// Rasterizes apps/mobile/assets/images/brand/*.svg into the PNG asset set
// expo.icon / expo.android.adaptiveIcon / expo.web.favicon / expo-splash-screen
// reference in app.json. Re-run after editing a brand/*.svg source.
//
// Usage: node apps/mobile/scripts/generate-brand-assets.mjs

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.join(__dirname, '..', 'assets', 'images', 'brand');
const outDir = path.join(__dirname, '..', 'assets', 'images');

const targets = [
  { src: 'icon-master.svg', out: 'icon.png', size: 1024 },
  { src: 'icon-master.svg', out: 'favicon.png', size: 48 },
  { src: 'mark-adaptive.svg', out: 'android-icon-foreground.png', size: 1024 },
  { src: 'background-night.svg', out: 'android-icon-background.png', size: 1024 },
  { src: 'mark-monochrome.svg', out: 'android-icon-monochrome.png', size: 1024 },
  { src: 'mark-color.svg', out: 'splash-icon.png', size: 228 },
];

for (const { src, out, size } of targets) {
  const srcPath = path.join(brandDir, src);
  const outPath = path.join(outDir, out);
  await sharp(srcPath, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`${out} <- ${src} (${size}x${size})`);
}
