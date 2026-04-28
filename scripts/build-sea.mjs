import { build } from 'esbuild';
import {
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const seaDir = path.join(root, 'dist/sea');
const clientDir = path.join(root, 'dist/client');

if (!existsSync(clientDir)) {
  console.error(
    `[build-sea] client bundle missing at ${clientDir}.\n` +
      `Run "npm run build:client" first.`,
  );
  process.exit(1);
}

if (existsSync(seaDir)) rmSync(seaDir, { recursive: true, force: true });
mkdirSync(seaDir, { recursive: true });

await build({
  entryPoints: [path.join(root, 'server/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(seaDir, 'server.cjs'),
  external: [],
  define: { 'process.env.LLSGC_SEA': '"true"' },
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  treeShaking: true,
  logLevel: 'info',
});
console.log('✓ server bundled (CJS) → dist/sea/server.cjs');

const assets = listClientFiles(clientDir);
console.log(`✓ found ${Object.keys(assets).length} client asset files`);

const seaConfig = {
  main: rel(path.join(seaDir, 'server.cjs')),
  output: rel(path.join(seaDir, 'sea-prep.blob')),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
  assets,
};

writeFileSync(
  path.join(seaDir, 'sea-config.json'),
  JSON.stringify(seaConfig, null, 2),
);
console.log('✓ sea-config.json written → dist/sea/sea-config.json');
console.log('');
console.log('Next steps (typically run from CI on windows-latest):');
console.log('  node --experimental-sea-config dist/sea/sea-config.json');
console.log('  node -e "require(\'fs\').copyFileSync(process.execPath, \'release/llsgc-server.exe\')"');
console.log('  npx postject release/llsgc-server.exe NODE_SEA_BLOB \\');
console.log('    dist/sea/sea-prep.blob \\');
console.log('    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');

function listClientFiles(dir, base = '') {
  const result = {};
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const relPath = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) {
      Object.assign(result, listClientFiles(full, relPath));
    } else {
      result[`/${relPath}`] = rel(full);
    }
  }
  return result;
}

function rel(absPath) {
  return path.relative(root, absPath).replace(/\\/g, '/');
}
