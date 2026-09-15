import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { DEFAULT_SECRETS, harness } from './harness';

describe('cli basics', () => {
  it('--version prints the version', async () => {
    const h = await harness();
    const r = await h.run('--version');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('0.1.0\n');
  });

  it('a missing subcommand is exit 2 with a JSON error', async () => {
    const h = await harness();
    const r = await h.run('projects');
    expect(r.code).toBe(2);
    expect(r.err.title).toBe('missing subcommand');
    expect(r.stdout).toBe('');
  });

  it('an unknown option is exit 2', async () => {
    const h = await harness();
    const r = await h.run('whoami', '--bogus');
    expect(r.code).toBe(2);
    expect(r.err.title).toContain('unknown option');
  });

  it('config errors are exit 3', async () => {
    const h = await harness({ config: null, secrets: {} });
    const r = await h.run('whoami');
    expect(r.code).toBe(3);
    expect(r.err.title).toBe('no profile configured');
  });
});

describe('whoami', () => {
  it('prints profile, user and url', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { id: 7, username: 'trung', email: 'x@y.z' }));
    const r = await h.run('whoami');
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ profile: 'me', user_id: 7, username: 'trung', url: 'https://vk.test' });
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/user');
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_me');
  });

  it('--as switches the token', async () => {
    const h = await harness({ secrets: { ...DEFAULT_SECRETS, 'profile:reviewer': 'tk_rev' } });
    h.reply(jsonResponse(200, { id: 8, username: 'bot-reviewer' }));
    const r = await h.run('whoami', '--as', 'reviewer');
    expect(r.out.profile).toBe('reviewer');
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_rev');
  });

  it('--as is rejected when the session is locked', async () => {
    const h = await harness({ env: { VIKUNJA_PROFILE_LOCK: '1' } });
    const r = await h.run('whoami', '--as', 'reviewer');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('--full prints the raw user object with dates normalized', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { id: 7, username: 'trung', created: '0001-01-01T00:00:00Z' }));
    const r = await h.run('whoami', '--full');
    expect(r.out).toEqual({
      profile: 'me',
      url: 'https://vk.test',
      user: { id: 7, username: 'trung', created: null },
    });
  });

  it('a 401 from /user (e.g. missing the user permission) is exit 3 with a permission hint', async () => {
    const h = await harness();
    h.reply(jsonResponse(401, { code: 11, message: 'missing, malformed, expired or otherwise invalid token provided' }, 'application/json'));
    const r = await h.run('whoami');
    expect(r.code).toBe(3);
    expect(r.err.title).toBe('Vikunja rejected the token for profile `me`');
    expect(r.err.detail).toContain('`user` permission');
  });
});
