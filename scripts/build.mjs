import { cp, lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateData } from './validate-data.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUILD_FILES = ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest', 'js/app.js', 'js/engine.js', 'js/pwa.js', '_headers'];
export const BUILD_DIRECTORIES = ['data', 'sources', 'icons'];

async function checkTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Build input must not be a symlink: ${path}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await checkTree(join(path, name));
  } else if (!info.isFile()) throw new Error(`Unsupported build input: ${path}`);
}

export async function build() {
  const output = resolve(APP_ROOT, 'dist');
  if (dirname(output) !== APP_ROOT || basename(output) !== 'dist' || relative(APP_ROOT, output) !== 'dist') {
    throw new Error('Refusing to clear an output outside the application directory.');
  }
  // Validate all inputs and source provenance before replacing the previous build.
  await validateData({ root: APP_ROOT });
  for (const entry of [...BUILD_FILES, ...BUILD_DIRECTORIES]) await checkTree(join(APP_ROOT, entry));
  try {
    if ((await lstat(output)).isSymbolicLink()) throw new Error('The build output must not be a symlink.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const entry of [...BUILD_FILES, ...BUILD_DIRECTORIES]) {
    const source = join(APP_ROOT, entry);
    const destination = join(output, entry);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: (await stat(source)).isDirectory(), force: false, errorOnExist: true });
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(`Built static application: ${await build()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
