import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  loadConfig,
  resolveConnection,
  resolveIdentity,
  saveConfig,
  type ConfigFile,
  type Env,
} from '../src/config';
import { memoryKeychain } from './fakes';

let env: Env;

beforeEach(async () => {
  env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'vikunja-cli-')) };
});

describe('config file', () => {
  it('lives under XDG_CONFIG_HOME', () => {
    expect(configPath(env)).toBe(join(env.XDG_CONFIG_HOME!, 'vikunja-cli', 'config.json'));
  });

  it('is empty when missing', async () => {
    expect(await loadConfig(env)).toEqual({ profiles: {} });
  });

  it('saves with mode 600 and loads back', async () => {
    const cfg: ConfigFile = { url: 'https://vk.test', default_profile: 'me', profiles: { me: { username: 'trung' } } };
    await saveConfig(env, cfg);
    expect(await loadConfig(env)).toEqual(cfg);
    expect((await stat(configPath(env))).mode & 0o777).toBe(0o600);
  });

  it('throws exit 3 on invalid JSON', async () => {
    await mkdir(join(env.XDG_CONFIG_HOME!, 'vikunja-cli'), { recursive: true });
    await writeFile(configPath(env), '{nope');
    await expect(loadConfig(env)).rejects.toMatchObject({ exitCode: 3, info: { title: 'cannot read config file' } });
  });
});

describe('resolveConnection', () => {
  const stored = () => memoryKeychain({ 'cf:client-id': 'kc-id', 'cf:client-secret': 'kc-secret' });

  it('reads stored values and strips trailing slashes', async () => {
    expect(await resolveConnection(env, stored(), { url: 'https://vk.test//', profiles: {} })).toEqual({
      url: 'https://vk.test',
      cfClientId: 'kc-id',
      cfClientSecret: 'kc-secret',
    });
  });

  it('prefers env vars', async () => {
    const e = { ...env, VIKUNJA_URL: 'https://env.test', CF_ACCESS_CLIENT_ID: 'env-id', CF_ACCESS_CLIENT_SECRET: 'env-secret' };
    expect(await resolveConnection(e, stored(), { url: 'https://vk.test', profiles: {} })).toEqual({
      url: 'https://env.test',
      cfClientId: 'env-id',
      cfClientSecret: 'env-secret',
    });
  });

  it.each([
    ['url', { profiles: {} }, { 'cf:client-id': 'i', 'cf:client-secret': 's' }, 'Vikunja URL is not configured'],
    ['cf id', { url: 'https://vk.test', profiles: {} }, { 'cf:client-secret': 's' }, 'Cloudflare Access client ID is not configured'],
    ['cf secret', { url: 'https://vk.test', profiles: {} }, { 'cf:client-id': 'i' }, 'Cloudflare Access client secret is not configured'],
  ])('exit 3 when %s is missing', async (_name, cfg, items, title) => {
    await expect(resolveConnection(env, memoryKeychain(items), cfg as ConfigFile)).rejects.toMatchObject({
      exitCode: 3,
      info: { title },
    });
  });
});

describe('resolveIdentity', () => {
  const keychain = memoryKeychain({ 'profile:me': 'tk_me', 'profile:reviewer': 'tk_rev', 'profile:planner': 'tk_plan' });
  const cfg: ConfigFile = { default_profile: 'me', profiles: {} };

  it('--as wins over everything', async () => {
    const e = { ...env, VIKUNJA_PROFILE: 'planner', VIKUNJA_API_TOKEN: 'tk_env' };
    expect(await resolveIdentity('reviewer', e, keychain, cfg)).toEqual({ profile: 'reviewer', token: 'tk_rev' });
  });

  it('VIKUNJA_PROFILE beats VIKUNJA_API_TOKEN and the default', async () => {
    const e = { ...env, VIKUNJA_PROFILE: 'planner', VIKUNJA_API_TOKEN: 'tk_env' };
    expect(await resolveIdentity(undefined, e, keychain, cfg)).toEqual({ profile: 'planner', token: 'tk_plan' });
  });

  it('VIKUNJA_API_TOKEN beats the default profile', async () => {
    const e = { ...env, VIKUNJA_API_TOKEN: 'tk_env' };
    expect(await resolveIdentity(undefined, e, keychain, cfg)).toEqual({ profile: '(env)', token: 'tk_env' });
  });

  it('falls back to the default profile', async () => {
    expect(await resolveIdentity(undefined, env, keychain, cfg)).toEqual({ profile: 'me', token: 'tk_me' });
  });

  it('rejects --as when the session is locked', async () => {
    const e = { ...env, VIKUNJA_PROFILE_LOCK: '1', VIKUNJA_PROFILE: 'planner' };
    await expect(resolveIdentity('reviewer', e, keychain, cfg)).rejects.toMatchObject({
      exitCode: 2,
      info: { title: 'profile is locked for this session' },
    });
  });

  it('a locked session still uses VIKUNJA_PROFILE', async () => {
    const e = { ...env, VIKUNJA_PROFILE_LOCK: '1', VIKUNJA_PROFILE: 'planner' };
    expect(await resolveIdentity(undefined, e, keychain, cfg)).toEqual({ profile: 'planner', token: 'tk_plan' });
  });

  it('--as naming the locked profile itself is allowed', async () => {
    const e = { ...env, VIKUNJA_PROFILE_LOCK: '1', VIKUNJA_PROFILE: 'planner' };
    expect(await resolveIdentity('planner', e, keychain, cfg)).toEqual({ profile: 'planner', token: 'tk_plan' });
  });

  it('unknown or invalid profile names are exit 3', async () => {
    await expect(resolveIdentity('ghost', env, keychain, cfg)).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'profile `ghost` not found' },
    });
    await expect(resolveIdentity('../x', env, keychain, cfg)).rejects.toMatchObject({ exitCode: 3 });
  });

  it('no profile at all is exit 3', async () => {
    await expect(resolveIdentity(undefined, env, keychain, { profiles: {} })).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'no profile configured' },
    });
  });
});
