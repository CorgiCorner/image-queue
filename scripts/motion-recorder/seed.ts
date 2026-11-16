import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { service } from '../../src/core/runtime';
const root = process.argv[2];
await mkdir(join(root, 'queue'), { recursive: true });
await writeFile(join(root, 'queue', 'images-todo.md'), '# Image requests\n');
process.env.IMAGE_QUEUE_STORAGE_DIR = join(root, 'store');
process.env.IMAGE_QUEUE_QUEUE_DIR = join(root, 'queue');
process.env.IMAGE_QUEUE_CREDENTIALS_DIR = join(root, 'credentials');
const api = await service();
const studio = await api.createProject('Studio collection', join(root, 'projects', 'studio'));
const colour = await api.createProject('Colour studies', join(root, 'projects', 'colour'));
for (let i = 0; i < 24; i++) {
  const w = i % 3 === 0 ? 960 : 720, h = i % 3 === 1 ? 960 : 720;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${i * 15},45%,80%)"/><circle cx="${w * .65}" cy="${h * .3}" r="${w * .13}" fill="hsl(${i * 15},65%,55%)"/><path d="M0 ${h} L${w * .4} ${h * .35} L${w} ${h}Z" fill="hsl(${i * 15},30%,35%)"/><text x="24" y="56" font-family="Helvetica" font-size="40" fill="#222">${i + 1}</text></svg>`;
  await api.importImage(`Landscape study ${i + 1}.png`, 'image/png', await sharp(Buffer.from(svg)).png().toBuffer(), i < 18 ? studio.id : colour.id);
}
console.log(JSON.stringify({ root, projects: 2, images: 24, providerCalls: 0 }));
