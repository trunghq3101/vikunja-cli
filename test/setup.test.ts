import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { jsonResponse } from './fakes';
import { DEFAULT_CONFIG, harness } from './harness';

describe('setup', () => {
  it('verifies through Cloudflare, then stores URL and credentials', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['https://vk.test/', 'abc.access', 'sec123'] });
    h.reply(jsonResponse(200, { version: 'v2.6.0' }));
    const r = await h.run('setup');
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ ok: true, url: 'https://vk.test', vikunja_version: 'v2.6.0' });
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/info');
    expect(h.calls[0].headers).toMatchObject({ 'CF-Access-Client-Id': 'abc.access', 'CF-Access-Client-Secret': 'sec123' });
    expect(h.calls[0].headers.Authorization).toBeUndefined();
    expect(h.keychain.items.get('cf:client-id')).toBe('abc.access');
    expect(h.keychain.items.get('cf:client-secret')).toBe('sec123');
    expect((await loadConfig(h.env)).url).toBe('https://vk.test');
    expect(h.prompts.map((p) => p.hidden)).toEqual([false, false, true]);
    expect(r.stdout).not.toContain('sec123');
  });

  it('stores nothing when Cloudflare rejects the credentials', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['https://vk.test', 'abc.access', 'wrong'] });
    h.reply(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await h.run('setup');
    expect(r.code).toBe(3);
    expect(h.keychain.items.size).toBe(0);
    expect(await loadConfig(h.env)).toEqual({ profiles: {} });
  });

  it('rejects an invalid URL before any request', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['vk.test', 'abc.access', 'sec123'] });
    const r = await h.run('setup');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('requires both client ID and secret', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['https://vk.test', 'abc.access', ''] });
    expect((await h.run('setup')).code).toBe(2);
  });

  it('keeps existing profiles', async () => {
    const h = await harness({ answers: ['https://new.test', 'abc.access', 'sec123'] });
    h.reply(jsonResponse(200, { version: 'v2.6.0' }));
    await h.run('setup');
    expect(await loadConfig(h.env)).toEqual({ ...DEFAULT_CONFIG, url: 'https://new.test' });
  });
});
