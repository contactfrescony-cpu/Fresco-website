'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

async function main() {
  const root = path.join(__dirname, '..');
  const source = path.join(root, 'src', 'assets', 'favicon.jpeg');
  const output = path.join(root, 'public');
  const icons = [
    ['favicon-16x16.png', 16], ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['android-chrome-192x192.png', 192], ['android-chrome-512x512.png', 512]
  ];
  await Promise.all(icons.map(([name, size]) => sharp(source).resize(size, size).png()
    .toFile(path.join(output, name))));

  // ICO directory with PNG entries for desktop browsers and Windows shortcuts.
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map((size) => sharp(source).resize(size, size).png().toBuffer()));
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, i) => {
    const entry = 6 + i * 16;
    directory[entry] = sizes[i];
    directory[entry + 1] = sizes[i];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  await fs.writeFile(path.join(output, 'favicon.ico'), Buffer.concat([directory, ...images]));
  console.log('Generated browser, Apple and Android favicons from src/assets/favicon.jpeg');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
