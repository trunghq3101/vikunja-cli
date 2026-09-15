import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import type { Obj } from '../output';

export function registerWhoami(program: Command, deps: Deps): void {
  program
    .command('whoami')
    .description('show the profile in use and the Vikunja user it maps to')
    .option('--as <profile>', 'act as this Vikunja profile')
    .action(async (opts: ApiOptions) => {
      const { client, identity, connection } = await apiContext(deps, opts);
      const user = await client.request<Obj>('GET', '/user');
      print(deps, { profile: identity.profile, user_id: user.id, username: user.username, url: connection.url });
    });
}
