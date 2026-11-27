'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

async function main() {
  const root = path.resolve(__dirname, '..');
  const out = path.join(root, 'build', 'icons');
  await fs.mkdir(out, { recursive: true });
  const svg = await fs.readFile(path.join(root, 'build', 'taiba-icon.svg'));
  const pngPath = path.join(out, 'taiba-256.png');
  await sharp(svg).resize(256, 256).png().toFile(pngPath);
  const ico = await pngToIco(pngPath);
  await fs.writeFile(path.join(out, 'taiba.ico'), ico);
  process.stdout.write('Generated Windows application icon.\n');
}

main().catch(error => {
  process.stderr.write(String(error?.stack || error) + '\n');
  process.exitCode = 1;
});
