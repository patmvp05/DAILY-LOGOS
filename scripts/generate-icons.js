import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputSvg = path.resolve(__dirname, '../public/icons/logo.svg');
const outputDir = path.resolve(__dirname, '../public/icons/');

const sizes = [
  { name: 'logo-180.png', size: 180 },
  { name: 'logo-192.png', size: 192 },
  { name: 'logo-512.png', size: 512 },
];

async function generateIcons() {
  if (!fs.existsSync(inputSvg)) {
    console.error(`Input SVG not found: ${inputSvg}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (const { name, size } of sizes) {
    const outputPath = path.join(outputDir, name);
    await sharp(inputSvg)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated ${name} (${size}x${size})`);
  }
}

generateIcons().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
