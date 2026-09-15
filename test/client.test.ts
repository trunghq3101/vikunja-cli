import { describe, expect, it } from 'vitest';
import { buildUrl, VikunjaClient, type FetchFn } from '../src/client';
import { fakeFetch, jsonResponse } from './fakes';

const connection = { url: 'https://vk.test', cfClientId: 'cf-id', cfClientSecret: 'cf-secret' };
const makeClient = (fetch: FetchFn, timeoutMs?: number) =>
  new VikunjaClient({ connection, token: 'tk_me', profile: 'me', fetch, timeoutMs });

const CF_TITLE = 'Cloudflare Access rejected the request — check the service token (vikunja setup)';

describe('buildUrl', () => {
  it('prefixes /api/v2, repeats arrays and skips undefined', () => {
    expect(
      buildUrl('https://vk.test', '/tasks', {
        q: 'a b',
        filter: undefined,
        sort_by: ['due_date', 'id'],
        order_by: ['asc', 'desc'],
        page: 2,
      }),
    ).toBe('https://vk.test/api/v2/tasks?q=a+b&sort_by=due_date&sort_by=id&order_by=asc&order_by=desc&page=2');
  });

  it('has no question mark without query', () => {
    expect(buildUrl('https://vk.test', '/user')).toBe('https://vk.test/api/v2/user');
  });
});

describe('VikunjaClient.request', () => {
  it('sends Cloudflare and bearer headers, manual redirects, and parses JSON', async () => {
    const f = fakeFetch(jsonResponse(200, { id: 1 }));
    expect(await makeClient(f.fn).request('GET', '/user')).toEqual({ id: 1 });
    expect(f.calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://vk.test/api/v2/user',
      headers: { 'CF-Access-Client-Id': 'cf-id', 'CF-Access-Client-Secret': 'cf-secret', Authorization: 'Bearer tk_me' },
    });
    expect(f.calls[0].init.redirect).toBe('manual');
  });

  it('omits Authorization without a token', async () => {
    const f = fakeFetch(jsonResponse(200, { version: 'v2.6.0' }));
    await new VikunjaClient({ connection, fetch: f.fn }).request('GET', '/info');
    expect(f.calls[0].headers.Authorization).toBeUndefined();
  });

  it('uses application/json for POST and merge-patch+json for PATCH', async () => {
    const f = fakeFetch(jsonResponse(201, { id: 2 }), jsonResponse(200, { id: 2 }));
    const client = makeClient(f.fn);
    await client.request('POST', '/labels', { body: { title: 'x' } });
    await client.request('PATCH', '/tasks/2', { body: { done: true }, headers: { 'X-Vikunja-Format': 'markdown' } });
    expect(f.calls[0].headers['Content-Type']).toBe('application/json');
    expect(f.calls[0].body).toEqual({ title: 'x' });
    expect(f.calls[1].headers['Content-Type']).toBe('application/merge-patch+json');
    expect(f.calls[1].headers['X-Vikunja-Format']).toBe('markdown');
  });

  it('returns undefined for 204', async () => {
    const f = fakeFetch(jsonResponse(204));
    expect(await makeClient(f.fn).request('DELETE', '/tasks/1')).toBeUndefined();
  });

  it.each([
    ['a redirect to cloudflareaccess.com', new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } })],
    ['an HTML page', new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })],
    ['a 403 without problem+json', new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })],
  ])('maps %s to exit 3', async (_name, response) => {
    await expect(makeClient(fakeFetch(response).fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 3,
      info: { title: CF_TITLE },
    });
  });

  it('maps 401 to exit 3 naming the profile', async () => {
    const f = fakeFetch(jsonResponse(401, { title: 'Unauthorized', status: 401 }, 'application/problem+json'));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'Vikunja token for profile `me` is invalid or expired', status: 401 },
    });
  });

  it('maps problem+json errors to exit 1 with details', async () => {
    const problem = {
      title: 'Unprocessable Entity',
      status: 422,
      detail: 'validation failed',
      errors: [{ location: 'body.title', message: 'required' }],
    };
    const f = fakeFetch(jsonResponse(422, problem, 'application/problem+json'));
    const err = (await makeClient(f.fn).request('POST', '/labels', { body: {} }).catch((e: any) => e)) as any;
    expect(err.exitCode).toBe(1);
    expect(err.info).toEqual(problem);
  });

  it('treats a Vikunja 403 problem+json as an API error', async () => {
    const f = fakeFetch(jsonResponse(403, { title: 'Forbidden', status: 403 }, 'application/problem+json'));
    await expect(makeClient(f.fn).request('GET', '/projects/1')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'Forbidden', status: 403 },
    });
  });

  it('uses HTTP <status> when the error body is not JSON', async () => {
    const f = fakeFetch(new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } }));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'HTTP 502', status: 502, detail: 'bad gateway' },
    });
  });

  it('maps network failures to exit 1', async () => {
    const f = fakeFetch(new TypeError('fetch failed'));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'network error' },
    });
  });

  it('maps timeouts to exit 1', async () => {
    const f = fakeFetch(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    await expect(makeClient(f.fn, 5000).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'request timed out after 5s' },
    });
  });

  it('maps an invalid JSON success body to exit 1', async () => {
    const f = fakeFetch(new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'invalid response from server', status: 200 },
    });
  });

  it('maps a non-Cloudflare redirect to exit 1 with the Location header in detail', async () => {
    const f = fakeFetch(
      new Response('', { status: 301, headers: { location: 'https://vk.test/api/v2/user', 'content-type': 'text/plain' } }),
    );
    const err = (await makeClient(f.fn).request('GET', '/user').catch((e: any) => e)) as any;
    expect(err.exitCode).toBe(1);
    expect(err.info.title).toBe('HTTP 301');
    expect(err.info.detail).toContain('https://vk.test/api/v2/user');
  });
});

describe('pagination', () => {
  const page = (items: number[], pageNo: number, totalPages: number, total: number) =>
    jsonResponse(200, { items: items.map((id) => ({ id })), page: pageNo, per_page: 2, total_pages: totalPages, total });

  it('listPage passes the query through', async () => {
    const f = fakeFetch(page([1, 2], 1, 1, 2));
    const res = await makeClient(f.fn).listPage('/labels', { page: 1, per_page: 2 });
    expect(res.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(f.calls[0].url).toBe('https://vk.test/api/v2/labels?page=1&per_page=2');
  });

  it('listAll follows total_pages', async () => {
    const f = fakeFetch(page([1, 2], 1, 2, 3), page([3], 2, 2, 3));
    expect(await makeClient(f.fn).listAll('/labels', { per_page: 2 })).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 3,
    });
    expect(new URL(f.calls[1].url).searchParams.get('page')).toBe('2');
  });

  it('listAll stops at the cap and marks the result truncated', async () => {
    const f = fakeFetch(page([1, 2], 1, 3, 6), page([3, 4], 2, 3, 6));
    expect(await makeClient(f.fn).listAll('/labels', { per_page: 2 }, 3)).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 6,
      truncated: true,
    });
    expect(f.calls).toHaveLength(2);
  });

  it('listAll treats null items as empty', async () => {
    const f = fakeFetch(jsonResponse(200, { items: null, page: 1, per_page: 50, total_pages: 0, total: 0 }));
    expect(await makeClient(f.fn).listAll('/labels', {})).toEqual({ items: [], total: 0 });
  });
});
