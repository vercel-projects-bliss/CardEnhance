import { cp, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const name of ['models', 'ort', 'samples']) {
 await mkdir(`public/${name}`, { recursive: true });
 await cp(path.join(root, 'public', name), `public/${name}`, { recursive: true });
}

// The legacy demo-front/demo-back assets depict different wrestlers.
// Use a same-named real card pair for the seller pairing example.
await copyFile(path.join(root, 'data/raw-cards/mina-shirakawa-dazzlers.jpg'), 'public/samples/seller-front.jpg');
await copyFile(path.join(root, 'data/raw-cards/mina-shirakawa-dazzlers-back.jpg'), 'public/samples/seller-back.jpg');
