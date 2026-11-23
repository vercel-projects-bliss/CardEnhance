import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const name of ['models', 'ort', 'samples']) {
 await mkdir(`public/${name}`, { recursive: true });
 await cp(path.join(root, 'public', name), `public/${name}`, { recursive: true });
}
