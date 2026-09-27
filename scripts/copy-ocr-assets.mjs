// Copy the in-browser OCR engine's runtime files (receipt reading, #142 v2)
// out of node_modules into public/ocr/<version>/, so the browser loads them
// from this app's own origin instead of a CDN.
//
//   worker.min.js                      tesseract.js web worker
//   core/tesseract-core-*-lstm.wasm.js WebAssembly engine (the worker picks
//                                      the build this device supports)
//   lang/{eng,fra}.traineddata.gz      English and French models
//
// Versions are pinned exactly in package.json and their contents by the
// sha512 integrity hashes in package-lock.json, which `npm ci` verifies. The
// output is generated, so public/ocr is gitignored. Runs before `dev` and
// `build`; safe to run repeatedly.

import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
const { version } = JSON.parse(
  readFileSync(join(modules, "tesseract.js", "package.json"), "utf8"),
);

const outBase = join(root, "public", "ocr");
const out = join(outBase, version);
// Old versions go, so an upgrade never leaves a stale engine being served.
rmSync(outBase, { recursive: true, force: true });

const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ...["", "simd-", "relaxedsimd-"].map((variant) => [
    `tesseract.js-core/tesseract-core-${variant}lstm.wasm.js`,
    `core/tesseract-core-${variant}lstm.wasm.js`,
  ]),
  ...["eng", "fra"].map((lang) => [
    `@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    `lang/${lang}.traineddata.gz`,
  ]),
];

for (const [from, to] of files) {
  const target = join(out, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(modules, from), target);
}
console.log(`OCR assets for tesseract.js ${version} copied to public/ocr/${version}`);
