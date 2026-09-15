import type { Command } from 'commander';
import { VikunjaClient } from '../client';
import { loadConfig, PROFILE_NAME, profileAccount, resolveConnection, saveConfig, type ConfigFile } from '../config';
import { print, type Deps } from '../context';
import { CliError, usageError } from '../errors';
import type { Obj } from '../output';

function notFound(name: string): CliError {
  return new CliError(3, `profile \`${name}\` not found`, { detail: 'run `vikunja profile list` to see configured profiles' });
}

export function registerProfile(program: Command, deps: Deps): void {
  const profile = program.command('profile').description('manage Vikunja identities (run by a human)');

  profile
    .command('add <name>')
    .description('store a Vikunja API token under a profile name (token read from a hidden prompt or stdin)')
    .action(async (name: string) => {
      if (!PROFILE_NAME.test(name)) {
        throw usageError(`invalid profile name: ${name}`, 'use lowercase letters, digits, - and _ (max 32 characters)');
      }
      const cfg = await loadConfig(deps.env);
      const connection = await resolveConnection(deps.env, deps.keychain, cfg);
      const token = await deps.prompter.ask(`Vikunja API token for ${name}: `, { hidden: true });
      if (!token) throw usageError('token is required');

      const client = new VikunjaClient({ connection, token, profile: name, fetch: deps.fetch });
      const user = await client.request<Obj>('GET', '/user');

      await deps.keychain.set(profileAccount(name), token);
      const defaultProfile = cfg.default_profile ?? name;
      await saveConfig(deps.env, {
        ...cfg,
        default_profile: defaultProfile,
        profiles: { ...cfg.profiles, [name]: { username: user.username } },
      });
      print(deps, { name, username: user.username, default: defaultProfile === name });
    });

  profile
    .command('list')
    .description('list profiles (never prints tokens)')
    .action(async () => {
      const cfg = await loadConfig(deps.env);
      const items = Object.entries(cfg.profiles)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, meta]) => ({ name, username: meta.username, default: cfg.default_profile === name }));
      print(deps, { items });
    });

  profile
    .command('default <name>')
    .description('set the profile used when neither --as nor VIKUNJA_PROFILE is given')
    .action(async (name: string) => {
      const cfg = await loadConfig(deps.env);
      if (!cfg.profiles[name]) throw notFound(name);
      await saveConfig(deps.env, { ...cfg, default_profile: name });
      print(deps, { default_profile: name });
    });

  profile
    .command('remove <name>')
    .description('delete a profile and its stored token')
    .action(async (name: string) => {
      const cfg = await loadConfig(deps.env);
      if (!cfg.profiles[name]) throw notFound(name);
      await deps.keychain.delete(profileAccount(name));
      const { [name]: _removed, ...profiles } = cfg.profiles;
      const next: ConfigFile = { ...cfg, profiles };
      if (next.default_profile === name) delete next.default_profile;
      await saveConfig(deps.env, next);
      print(deps, { removed: name });
    });
}
