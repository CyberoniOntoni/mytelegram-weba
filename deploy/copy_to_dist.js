import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dest = path.resolve(root, process.argv[2] || 'dist');

mkdirSync(dest, { recursive: true });

function copyDir(src, targetDir) {
  if (!existsSync(src)) {
    console.warn(`skip missing: ${path.relative(root, src)}`);
    return;
  }

  cpSync(src, targetDir, { recursive: true, force: true });
}

function copyFile(src, targetFile) {
  if (!existsSync(src)) {
    console.warn(`skip missing: ${path.relative(root, src)}`);
    return;
  }

  mkdirSync(path.dirname(targetFile), { recursive: true });
  copyFileSync(src, targetFile);
}

copyDir(path.join(root, 'public'), dest);
copyFile(
  path.join(root, 'src/lib/rlottie/rlottie-wasm.wasm'),
  path.join(dest, 'rlottie-wasm.wasm'),
);
copyFile(
  path.join(root, 'node_modules/opus-recorder/dist/decoderWorker.min.wasm'),
  path.join(dest, 'decoderWorker.min.wasm'),
);
copyDir(
  path.join(root, 'node_modules/emoji-data-ios/img-apple-64'),
  path.join(dest, 'img-apple-64'),
);
copyDir(
  path.join(root, 'node_modules/emoji-data-ios/img-apple-160'),
  path.join(dest, 'img-apple-160'),
);

console.log(`Copied static assets to ${dest}`);