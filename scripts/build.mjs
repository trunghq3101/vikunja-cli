import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const OUTFILE = 'plugin/bin/vikunja';

/** @type {import('esbuild').BuildOptions} */
export const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build({ ...buildOptions, outfile: OUTFILE });
  await chmod(OUTFILE, 0o755);
}
