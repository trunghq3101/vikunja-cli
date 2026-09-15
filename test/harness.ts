import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli';
import type { ConfigFile, Env } from '../src/config';
import type { Deps } from '../src/context';
import { fakeFetch, memoryKeychain } from './fakes';

export const DEFAULT_CONFIG: ConfigFile = {
  url: 'https://vk.test',
  default_profile: 'me',
  profiles: { me: { username: 'trung' } },
};

export const DEFAULT_SECRETS: Record<string, string> = {
  'cf:client-id': 'cf-id',
  'cf:client-secret': 'cf-secret',
  'profile:me': 'tk_me',
};

export interface HarnessOptions {
  env?: Env;
  config?: ConfigFile | null;
  secrets?: Record<string, string>;
  answers?: string[];
}

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export async function harness(options: HarnessOptions = {}) {
  const configHome = await mkdtemp(join(tmpdir(), 'vikunja-cli-test-'));
  const env: Env = { XDG_CONFIG_HOME: configHome, ...options.env };
  const config = options.config === undefined ? DEFAULT_CONFIG : options.config;
  if (config) {
    await mkdir(join(configHome, 'vikunja-cli'), { recursive: true });
    await writeFile(join(configHome, 'vikunja-cli', 'config.json'), JSON.stringify(config));
  }
  const keychain = memoryKeychain(options.secrets ?? DEFAULT_SECRETS);
  const http = fakeFetch();
  const answers = [...(options.answers ?? [])];
  const prompts: Array<{ question: string; hidden: boolean }> = [];

  async function run(...argv: string[]) {
    let stdout = '';
    let stderr = '';
    const deps: Deps = {
      env,
      keychain,
      fetch: http.fn,
      io: {
        stdout: (text) => void (stdout += text),
        stderr: (text) => void (stderr += text),
      },
      prompter: {
        async ask(question, opts) {
          prompts.push({ question, hidden: Boolean(opts?.hidden) });
          return answers.shift() ?? '';
        },
        close() {},
      },
    };
    const code = await runCli(argv, deps);
    return { code, stdout, stderr, out: parseJson(stdout) as any, err: parseJson(stderr)?.error as any };
  }

  return { run, env, keychain, calls: http.calls, reply: http.queue, prompts, configHome };
}
