import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { VERSION } from '../src/cli';

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

it('package.json, plugin.json and the CLI share one version', async () => {
  expect((await readJson('package.json')).version).toBe(VERSION);
  expect((await readJson('plugin/.claude-plugin/plugin.json')).version).toBe(VERSION);
});

it('the marketplace lists the plugin from ./plugin', async () => {
  const marketplace = await readJson('.claude-plugin/marketplace.json');
  expect(marketplace.name).toBe('vikunja-cli');
  expect(marketplace.plugins).toEqual([expect.objectContaining({ name: 'vikunja', source: './plugin' })]);
});

it('the skill pre-approves only agent commands, never setup or profile', async () => {
  const skill = await readFile('plugin/skills/vikunja/SKILL.md', 'utf8');
  const line = skill.split('\n').find((l) => l.startsWith('allowed-tools:'));
  expect(line).toBe(
    'allowed-tools: Bash(vikunja whoami) Bash(vikunja whoami *) Bash(vikunja projects *) Bash(vikunja tasks *) Bash(vikunja labels *) Bash(vikunja buckets *) Bash(vikunja comments *)',
  );
});
