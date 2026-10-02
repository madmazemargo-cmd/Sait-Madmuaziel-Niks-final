import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(repositoryRoot, 'artifacts/nyx-dnd-site/source-assets');
const assetDirectory = path.join(repositoryRoot, 'artifacts/nyx-dnd-site/public/assets');
const sourceAssets = [
  'system-dnd.png',
  'system-vampires.png',
  'system-daggerheart.png',
  'system-cyberpunk.png',
  'system-cthulhu.png',
  'nyx-cutout.png',
];

for (const sourceName of sourceAssets) {
  const sourcePath = path.join(sourceDirectory, sourceName);
  const outputPath = path.join(assetDirectory, `${path.parse(sourceName).name}.webp`);
  await sharp(sourcePath).webp({ quality: 82, effort: 6 }).toFile(outputPath);
  const source = await sharp(sourcePath).metadata();
  const output = await sharp(outputPath).metadata();
  console.log(`${sourceName} (${source.width}x${source.height}) -> ${path.basename(outputPath)} (${output.width}x${output.height})`);
}
