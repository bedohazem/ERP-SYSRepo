import { build } from 'esbuild';

await build({
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  minify: true,
  sourcemap: false,
  external: [
    'electron',
    'better-sqlite3'
  ]
});

console.log('Built main process to dist/main/index.cjs');