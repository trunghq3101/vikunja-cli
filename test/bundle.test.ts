import { build } from 'esbuild';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildOptions, OUTFILE } from '../scripts/build.mjs';

describe('bundle', () => {
  it('committed plugin/bin/vikunja matches the sources', async () => {
    const result = await build({ ...buildOptions, outfile: OUTFILE, write: false });
    const fresh = result.outputFiles![0].text;
    const committed = await readFile(OUTFILE, 'utf8');
    expect(committed === fresh, 'plugin/bin/vikunja is stale: run `npm run build` and commit it').toBe(true);
  }, 30_000);

  it('is executable and starts with a node shebang', async () => {
    expect((await stat(OUTFILE)).mode & 0o111).not.toBe(0);
    expect((await readFile(OUTFILE, 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});
