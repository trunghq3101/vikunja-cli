import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError } from './errors';
import type { Keychain } from './keychain';

export type Env = Record<string, string | undefined>;

export interface ConfigFile {
  url?: string;
  default_profile?: string;
  profiles: Record<string, { username: string }>;
}

export interface Connection {
  url: string;
  cfClientId: string;
  cfClientSecret: string;
}

export interface Identity {
  profile: string;
  token: string;
}

export const ACCOUNT_CF_ID = 'cf:client-id';
export const ACCOUNT_CF_SECRET = 'cf:client-secret';
export const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function profileAccount(name: string): string {
  return `profile:${name}`;
}

export function configPath(env: Env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'vikunja-cli', 'config.json');
}

export async function loadConfig(env: Env): Promise<ConfigFile> {
  const path = configPath(env);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<ConfigFile>;
    return { ...parsed, profiles: parsed.profiles ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: {} };
    throw new CliError(3, 'cannot read config file', { detail: `${path}: ${(err as Error).message}` });
  }
}

export async function saveConfig(env: Env, cfg: ConfigFile): Promise<void> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function notConfigured(what: string, envVar: string): CliError {
  return new CliError(3, `${what} is not configured`, { detail: `set ${envVar} or run \`vikunja setup\`` });
}

export async function resolveConnection(env: Env, keychain: Keychain, cfg: ConfigFile): Promise<Connection> {
  const url = env.VIKUNJA_URL || cfg.url;
  if (!url) throw notConfigured('Vikunja URL', 'VIKUNJA_URL');
  const cfClientId = env.CF_ACCESS_CLIENT_ID || (await keychain.get(ACCOUNT_CF_ID));
  if (!cfClientId) throw notConfigured('Cloudflare Access client ID', 'CF_ACCESS_CLIENT_ID');
  const cfClientSecret = env.CF_ACCESS_CLIENT_SECRET || (await keychain.get(ACCOUNT_CF_SECRET));
  if (!cfClientSecret) throw notConfigured('Cloudflare Access client secret', 'CF_ACCESS_CLIENT_SECRET');
  return { url: normalizeUrl(url), cfClientId, cfClientSecret };
}

async function fromProfile(name: string, keychain: Keychain): Promise<Identity> {
  const token = PROFILE_NAME.test(name) ? await keychain.get(profileAccount(name)) : null;
  if (!token) {
    throw new CliError(3, `profile \`${name}\` not found`, { detail: 'run `vikunja profile list` to see configured profiles' });
  }
  return { profile: name, token };
}

export async function resolveIdentity(
  as: string | undefined,
  env: Env,
  keychain: Keychain,
  cfg: ConfigFile,
): Promise<Identity> {
  if (as !== undefined) {
    if (env.VIKUNJA_PROFILE_LOCK === '1' && as !== env.VIKUNJA_PROFILE) {
      throw new CliError(2, 'profile is locked for this session', {
        detail: 'VIKUNJA_PROFILE_LOCK=1 is set, so --as is not allowed',
      });
    }
    return fromProfile(as, keychain);
  }
  if (env.VIKUNJA_PROFILE) return fromProfile(env.VIKUNJA_PROFILE, keychain);
  if (env.VIKUNJA_API_TOKEN) return { profile: '(env)', token: env.VIKUNJA_API_TOKEN };
  if (cfg.default_profile) return fromProfile(cfg.default_profile, keychain);
  throw new CliError(3, 'no profile configured', { detail: 'run `vikunja profile add <name>`' });
}
