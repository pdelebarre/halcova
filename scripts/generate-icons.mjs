// Generate icon PNGs from icon-treasure-nook.svg
// Usage: node scripts/generate-icons.mjs

import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, '..', 'public');
const svgPath = resolve(publicDir, 'icon-treasure-nook.svg');

// Read the master SVG
const masterSvg = readFileSync(svgPath, 'utf-8');

// Maskable variant: strip the wordmark
const maskableSvg = masterSvg.replace(
  /<!-- 6\. Wordmark[\s\S]*?<\/text>/,
  '<!-- 6. Wordmark removed for maskable variant -->'
);

// Small-size variant (32px): thicker stroke, simpler card
// We modify stroke-width and remove rounded corners on the card
const smallSvg = masterSvg
  .replace(/<!-- 3\. Gothic pointed arch[\s\S]*?<\/path>/, (match) =>
    match.replace(/stroke-width="16"/, 'stroke-width="28"')
  )
  .replace(/<!-- 4\. Horizontal base line[\s\S]*?<\/line>/, (match) =>
    match.replace(/stroke-width="16"/, 'stroke-width="28"')
  )
  .replace(/rx="12" ry="12"/, 'rx="0" ry="0"')
  .replace(/<!-- 6\. Wordmark[\s\S]*?<\/text>/, '');

const targets = [
  { name: 'icon-512.png', size: 512, svg: masterSvg },
  { name: 'icon-maskable-512.png', size: 512, svg: maskableSvg },
  { name: 'icon-192.png', size: 192, svg: masterSvg.replace(/<!-- 6\. Wordmark[\s\S]*?<\/text>/, '') },
  { name: 'apple-touch-icon.png', size: 180, svg: masterSvg.replace(/<!-- 6\. Wordmark[\s\S]*?<\/text>/, '') },
  { name: 'favicon.png', size: 32, svg: smallSvg },
];

async function generate() {
  // Try sharp first
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp not available. Install with: npm install --save-dev sharp');
    console.error('Or use rsvg-convert: brew install librsvg');
    process.exit(1);
  }

  for (const { name, size, svg } of targets) {
    const buf = Buffer.from(
      svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)
    );
    const png = await sharp(buf).resize(size, size).png().toBuffer();
    const outPath = resolve(publicDir, name);
    writeFileSync(outPath, png);
    console.log(`✅ ${name} (${size}×${size})`);
  }

  // Also write the maskable SVG for reference
  writeFileSync(resolve(publicDir, 'icon-maskable-512.svg'), maskableSvg);
  console.log('✅ icon-maskable-512.svg');
  console.log('✅ icon-treasure-nook.svg (master)');
}

generate();
