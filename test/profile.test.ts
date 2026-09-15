import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { jsonResponse } from './fakes';
import { DEFAULT_CONFIG, DEFAULT_SECRETS, harness } from './harness';

const CF_ONLY = { 'cf:client-id': 'cf-id', 'cf:client-secret': 'cf-secret' };

describe('profile add', () => {
  it('verifies the token, stores it, and makes the first profile the default', async () => {
    const h = await harness({ config: { url: 'https://vk.test', profiles: {} }, secrets: CF_ONLY, answers: ['tk_new'] });
    h.reply(jsonResponse(200, { id: 7, username: 'bot-planner' }));
    const r = await h.run('profile', 'add', 'planner');
    expect(r.out).toEqual({ name: 'planner', username: 'bot-planner', default: true });
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_new');
    expect(h.prompts).toEqual([{ question: 'Vikunja API token for planner: ', hidden: true }]);
    expect(h.keychain.items.get('profile:planner')).toBe('tk_new');
    expect(await loadConfig(h.env)).toEqual({
      url: 'https://vk.test',
      default_profile: 'planner',
      profiles: { planner: { username: 'bot-planner' } },
    });
    expect(r.stdout).not.toContain('tk_new');
  });

  it('does not change an existing default', async () => {
    const h = await harness({ answers: ['tk_rev'] });
    h.reply(jsonResponse(200, { id: 8, username: 'bot-reviewer' }));
    const r = await h.run('profile', 'add', 'reviewer');
    expect(r.out.default).toBe(false);
    expect((await loadConfig(h.env)).default_profile).toBe('me');
  });

  it('stores nothing when the token is rejected', async () => {
    const h = await harness({ answers: ['tk_bad'] });
    h.reply(jsonResponse(401, { title: 'Unauthorized', status: 401 }, 'application/problem+json'));
    const r = await h.run('profile', 'add', 'reviewer');
    expect(r.code).toBe(3);
    expect(h.keychain.items.has('profile:reviewer')).toBe(false);
    expect(await loadConfig(h.env)).toEqual(DEFAULT_CONFIG);
  });

  it('a 401 from /user (e.g. missing the user permission) gives a permission hint and stores nothing', async () => {
    const h = await harness({ answers: ['tk_bad'] });
    h.reply(jsonResponse(401, { code: 11, message: 'missing, malformed, expired or otherwise invalid token provided' }, 'application/json'));
    const r = await h.run('profile', 'add', 'reviewer');
    expect(r.code).toBe(3);
    expect(r.err.title).toBe('Vikunja rejected the token for profile `reviewer`');
    expect(r.err.detail).toContain('`user` permission');
    expect(h.keychain.items.has('profile:reviewer')).toBe(false);
  });

  it('rejects invalid names without prompting', async () => {
    const h = await harness({ answers: ['tk_x'] });
    const r = await h.run('profile', 'add', 'Bad Name');
    expect(r.code).toBe(2);
    expect(h.prompts).toHaveLength(0);
  });

  it('rejects an empty token', async () => {
    const h = await harness({ answers: [''] });
    expect((await h.run('profile', 'add', 'reviewer')).code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('profile list/default/remove', () => {
  const config = { ...DEFAULT_CONFIG, profiles: { me: { username: 'trung' }, reviewer: { username: 'bot-reviewer' } } };
  const secrets = { ...DEFAULT_SECRETS, 'profile:reviewer': 'tk_rev' };

  it('list shows names, usernames and the default, never tokens', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'list');
    expect(r.out).toEqual({
      items: [
        { name: 'me', username: 'trung', default: true },
        { name: 'reviewer', username: 'bot-reviewer', default: false },
      ],
    });
    expect(r.stdout).not.toContain('tk_');
  });

  it('default switches the default profile', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'default', 'reviewer');
    expect(r.out).toEqual({ default_profile: 'reviewer' });
    expect((await loadConfig(h.env)).default_profile).toBe('reviewer');
    expect((await h.run('profile', 'default', 'ghost')).code).toBe(3);
  });

  it('remove deletes the token and clears the default if needed', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'remove', 'me');
    expect(r.out).toEqual({ removed: 'me' });
    expect(h.keychain.items.has('profile:me')).toBe(false);
    const saved = await loadConfig(h.env);
    expect(saved.profiles).toEqual({ reviewer: { username: 'bot-reviewer' } });
    expect(saved.default_profile).toBeUndefined();
    expect((await h.run('profile', 'remove', 'ghost')).code).toBe(3);
  });

  it('default and remove only match own profile entries, not inherited ones', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'default', 'constructor');
    expect(r.code).toBe(3);
    expect((await loadConfig(h.env)).default_profile).toBe('me');
    expect((await h.run('profile', 'remove', 'constructor')).code).toBe(3);
    expect((await loadConfig(h.env)).profiles).toEqual(config.profiles);
  });
});
