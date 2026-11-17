const sharp = require('sharp');
const path = require('node:path');

const generated = 'C:/Users/nbz14/.codex/generated_images/01a1e79e-45bc-7df3-97b4-090a7942d9b6';
const output = path.resolve(__dirname, '../public/interactive-rail');
const sheets = [
  ['utility-shirt', 'exec-1a288fda-7f53-4a63-9056-a1cce0b53ef1.png', [0, 310, 936, 1536]],
  ['ribbed-hoodie', 'exec-54941481-b3b3-4ab9-8c1d-37d9323cb9f0.png', [0, 350, 965, 1536]],
  ['fleece-jacket', 'exec-405394be-9868-4b20-bbdc-399afdd26e52.png', [0, 260, 900, 1536]],
  ['tommy-tee', 'exec-aeb7dda7-946b-42bc-b089-040964e52e64.png', [0, 240, 890, 1536]],
  ['desigual-tee', 'exec-db8fe568-2289-4790-b59e-2bbff3c71e0a.png', [0, 225, 880, 1536]],
  ['crocodile-text-tee', 'exec-a7e8a346-deac-43e6-806b-8a2380d7c8e4.png', [0, 235, 885, 1536]],
  ['indian-terrain-tee', 'exec-8cdf72e2-41b1-49ab-8168-0715e4ffd556.png', [0, 235, 895, 1536]],
  ['pepe-tee', 'exec-526e2b14-ccb7-4491-9097-bb5eab5b36d9.png', [0, 250, 900, 1536]],
  ['american-eagle-tee', 'exec-331b48fc-8319-42f0-b3b0-3a54855a554a.png', [0, 220, 880, 1536]]
];

// Generated sprite sheets can contain a thin, detached sliver of the adjacent
// view inside a crop. Keep only the garment/hanger component so those pixels do
// not appear beside the expanded front or back image on the rail.
async function keepLargestAlphaComponent(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let largest = [];
  const solidAlpha = 8;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || data[start * 4 + 3] < solidAlpha) continue;

    const component = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % info.width;
      component.push(pixel);

      const neighbours = [pixel - 1, pixel + 1, pixel - info.width, pixel + info.width];
      for (const neighbour of neighbours) {
        if (
          neighbour < 0 || neighbour >= pixelCount || visited[neighbour] ||
          data[neighbour * 4 + 3] < solidAlpha ||
          Math.abs((neighbour % info.width) - x) > 1
        ) continue;
        visited[neighbour] = 1;
        queue[tail++] = neighbour;
      }
    }

    if (component.length > largest.length) largest = component;
  }

  const keep = new Uint8Array(pixelCount);
  // Retain the main solid component plus a two-pixel alpha fringe so the
  // garment's anti-aliased edge stays smooth. Detached crop slivers are farther
  // away and are removed even when near-transparent pixels previously bridged
  // them to the garment.
  for (const pixel of largest) {
    const x = pixel % info.width;
    const y = Math.floor(pixel / info.width);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= info.width || nextY < 0 || nextY >= info.height) continue;
        const neighbour = nextY * info.width + nextX;
        if (data[neighbour * 4 + 3] > 0) keep[neighbour] = 1;
      }
    }
  }
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (keep[pixel]) continue;
    const offset = pixel * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }

  return sharp(data, { raw: info }).png().toBuffer();
}

(async () => {
  for (const [slug, filename, edges] of sheets) {
    if (process.argv[2] && slug !== process.argv[2]) continue;
    for (const [index, view] of ['side', 'front', 'back'].entries()) {
      const region = await sharp(path.join(generated, filename))
        .extract({ left: edges[index], top: 0, width: edges[index + 1] - edges[index], height: 1024 })
        .toBuffer();
      const crop = await sharp(region).trim({ threshold: 30 }).toBuffer();
      const width = view === 'side' ? 378 : 900;
      const filenameOut = `fresco-${slug}-${view}.webp`;
      const canvas = await sharp(crop).resize({ width: width - 24, height: 1055, fit: 'contain', background: '#00000000' })
        .extend({ top: 35, bottom: 35, left: 12, right: 12, background: '#00000000' })
        .png()
        .toBuffer();
      const cleaned = await keepLargestAlphaComponent(canvas);
      await sharp(cleaned)
        .webp({ quality: 88 }).toFile(path.join(output, filenameOut));
      console.log(filenameOut);
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
