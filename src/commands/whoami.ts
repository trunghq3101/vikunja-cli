import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { getCurrentUser } from './common';
import { normalizeDates } from '../output';

export function registerWhoami(program: Command, deps: Deps): void {
  program
    .command('whoami')
    .description('show the profile in use and the Vikunja user it maps to')
    .option('--as <profile>', 'act as this Vikunja profile')
    .option('--full', 'print the raw /user object instead of the summary')
    .action(async (opts: ApiOptions) => {
      const { client, identity, connection } = await apiContext(deps, opts);
      const user = await getCurrentUser(client);
      if (opts.full) {
        print(deps, { profile: identity.profile, url: connection.url, user: normalizeDates(user) });
        return;
      }
      print(deps, { profile: identity.profile, user_id: user.id, username: user.username, url: connection.url });
    });
}
