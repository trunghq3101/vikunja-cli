import type { Command } from 'commander';
import { VikunjaClient } from '../client';
import { ACCOUNT_CF_ID, ACCOUNT_CF_SECRET, loadConfig, normalizeUrl, saveConfig } from '../config';
import { print, type Deps } from '../context';
import { usageError } from '../errors';
import type { Obj } from '../output';

export function registerSetup(program: Command, deps: Deps): void {
  program
    .command('setup')
    .description('store the Vikunja URL and Cloudflare Access service token (run by a human)')
    .action(async () => {
      const cfg = await loadConfig(deps.env);
      const url = normalizeUrl(await deps.prompter.ask('Vikunja URL (e.g. https://vikunja.example.com): '));
      if (!/^https?:\/\/\S+$/.test(url)) throw usageError('invalid URL', 'expected http:// or https:// followed by the host');
      const cfClientId = await deps.prompter.ask('Cloudflare Access client ID: ');
      const cfClientSecret = await deps.prompter.ask('Cloudflare Access client secret: ', { hidden: true });
      if (!cfClientId || !cfClientSecret) throw usageError('client ID and secret are required');

      // Verify before storing so a typo never replaces working credentials.
      const client = new VikunjaClient({ connection: { url, cfClientId, cfClientSecret }, fetch: deps.fetch });
      const info = await client.request<Obj>('GET', '/info');

      await deps.keychain.set(ACCOUNT_CF_ID, cfClientId);
      await deps.keychain.set(ACCOUNT_CF_SECRET, cfClientSecret);
      await saveConfig(deps.env, { ...cfg, url });
      print(deps, { ok: true, url, vikunja_version: info?.version ?? null });
    });
}
