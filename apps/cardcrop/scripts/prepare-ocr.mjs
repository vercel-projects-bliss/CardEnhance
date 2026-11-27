import { copyFile, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const destination = path.resolve("public/ocr");
await mkdir(destination, { recursive: true });
const packageDirectory = (name) =>
  path.dirname(require.resolve(`${name}/package.json`));
await copyFile(
  path.join(packageDirectory("tesseract.js"), "dist/worker.min.js"),
  path.join(destination, "worker.min.js"),
);
const core = packageDirectory("tesseract.js-core");
// Include every build so the worker can choose the best supported WASM variant.
for (const file of await readdir(core)) {
  if (file.endsWith(".wasm") || file.endsWith(".wasm.js")) {
    await copyFile(path.join(core, file), path.join(destination, file));
  }
}
await copyFile(
  path.join(
    packageDirectory("@tesseract.js-data/eng"),
    "4.0.0/eng.traineddata.gz",
  ),
  path.join(destination, "eng.traineddata.gz"),
);
console.log(
  "Prepared same-origin OCR worker, WASM, and English language data.",
);
