import { Command, CommanderError } from 'commander';
import { registerComments } from './commands/comments';
import { registerLabels } from './commands/labels';
import { registerProfile } from './commands/profile';
import { registerProjects } from './commands/projects';
import { registerSetup } from './commands/setup';
import { registerTasks } from './commands/tasks';
import { registerWhoami } from './commands/whoami';
import type { Deps } from './context';
import { errorJson } from './errors';

export const VERSION = '0.1.0';

export function buildProgram(deps: Deps, captureErr: (text: string) => void = () => {}): Command {
  const program = new Command('vikunja')
    .description('Vikunja CLI for AI agents (API v2, Cloudflare Access, multiple profiles). Prints JSON.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (text) => deps.io.stdout(text), writeErr: captureErr, outputError: () => {} });
  registerWhoami(program, deps);
  registerProjects(program, deps);
  registerTasks(program, deps);
  registerLabels(program, deps);
  registerComments(program, deps);
  registerSetup(program, deps);
  registerProfile(program, deps);
  return program;
}

export async function runCli(argv: string[], deps: Deps): Promise<number> {
  let captured = '';
  const program = buildProgram(deps, (text) => {
    captured += text;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) return 0; // --help, --version
      const error =
        err.code === 'commander.help'
          ? { title: 'missing subcommand', detail: captured.trim() }
          : { title: err.message.replace(/^error: /, ''), detail: 'run with --help for usage' };
      deps.io.stderr(`${JSON.stringify({ error })}\n`);
      return 2;
    }
    const { exitCode, json } = errorJson(err);
    deps.io.stderr(`${json}\n`);
    return exitCode;
  } finally {
    deps.prompter.close();
  }
}
