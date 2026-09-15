import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const project = { id: 2, title: 'Home', description: 'desc', parent_project_id: 0, is_archived: false, hex_color: '' };
const page = (items: unknown[], pageNo = 1, totalPages = 1, total = items.length) =>
  jsonResponse(200, { items, page: pageNo, per_page: 50, total_pages: totalPages, total });
const query = (url: string) => new URL(url).searchParams;

describe('projects', () => {
  it('list sends search, archived, markdown and pagination', async () => {
    const h = await harness();
    h.reply(page([project]));
    const r = await h.run('projects', 'list', '--search', 'ho', '--archived');
    expect(new URL(h.calls[0].url).pathname).toBe('/api/v2/projects');
    const q = query(h.calls[0].url);
    expect([q.get('format'), q.get('q'), q.get('is_archived'), q.get('page'), q.get('per_page')]).toEqual([
      'markdown', 'ho', 'true', '1', '50',
    ]);
    expect(r.out).toEqual({
      items: [{ id: 2, title: 'Home', parent_project_id: 0, is_archived: false }],
      page: 1,
      per_page: 50,
      total_pages: 1,
      total: 1,
    });
  });

  it('list without --archived omits is_archived', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('projects', 'list');
    expect(query(h.calls[0].url).has('is_archived')).toBe(false);
  });

  it('list --page forwards the page number', async () => {
    const h = await harness();
    h.reply(page([project], 3, 5, 100));
    await h.run('projects', 'list', '--page', '3');
    expect(query(h.calls[0].url).get('page')).toBe('3');
  });

  it('list --all fetches every page', async () => {
    const h = await harness();
    h.reply(page([project], 1, 2, 2), page([{ ...project, id: 3 }], 2, 2, 2));
    const r = await h.run('projects', 'list', '--all');
    expect(r.out.items.map((p: { id: number }) => p.id)).toEqual([2, 3]);
    expect(r.out.total).toBe(2);
  });

  it('list rejects --per-page over 1000 before calling the API', async () => {
    const h = await harness();
    const r = await h.run('projects', 'list', '--per-page', '5000');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('get prints the detail view', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project));
    const r = await h.run('projects', 'get', '2');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/projects/2?format=markdown');
    expect(r.out).toEqual({ id: 2, title: 'Home', parent_project_id: 0, is_archived: false, description: 'desc' });
  });

  it('get --full prints the raw object', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project));
    const r = await h.run('projects', 'get', '2', '--full');
    expect(r.out.hex_color).toBe('');
  });

  it('get rejects a non-numeric id', async () => {
    const h = await harness();
    const r = await h.run('projects', 'get', 'abc');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('create posts title, description and parent', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, { ...project, id: 9, title: 'Work', parent_project_id: 2 }));
    const r = await h.run('projects', 'create', '--title', 'Work', '--description', '**x**', '--parent', '2');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/projects?format=markdown',
      body: { title: 'Work', description: '**x**', parent_project_id: 2 },
    });
    expect(r.out.id).toBe(9);
  });

  it('update with a description patches with the markdown header and re-reads', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { ...project, description: '<p>new</p>' }), jsonResponse(200, { ...project, description: 'new' }));
    const r = await h.run('projects', 'update', '2', '--description', 'new');
    expect(h.calls[0]).toMatchObject({ method: 'PATCH', url: 'https://vk.test/api/v2/projects/2', body: { description: 'new' } });
    expect(h.calls[0].headers['X-Vikunja-Format']).toBe('markdown');
    expect(h.calls[1]).toMatchObject({ method: 'GET', url: 'https://vk.test/api/v2/projects/2?format=markdown' });
    expect(r.out.description).toBe('new');
  });

  it('update without a description sends no format header', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project), jsonResponse(200, project));
    await h.run('projects', 'update', '2', '--title', 'Renamed');
    expect(h.calls[0].body).toEqual({ title: 'Renamed' });
    expect(h.calls[0].headers['X-Vikunja-Format']).toBeUndefined();
  });

  it('update with nothing to change is exit 2', async () => {
    const h = await harness();
    const r = await h.run('projects', 'update', '2');
    expect(r.code).toBe(2);
    expect(r.err.title).toBe('nothing to update');
  });

  it('archive and unarchive patch is_archived', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project), jsonResponse(200, { ...project, is_archived: true }));
    const archived = await h.run('projects', 'archive', '2');
    h.reply(jsonResponse(200, project), jsonResponse(200, project));
    await h.run('projects', 'unarchive', '2');
    expect(h.calls[0].body).toEqual({ is_archived: true });
    expect(archived.out.is_archived).toBe(true);
    expect(h.calls[2].body).toEqual({ is_archived: false });
  });

  it('delete requires --yes', async () => {
    const h = await harness();
    const r = await h.run('projects', 'delete', '2');
    expect(r.code).toBe(2);
    expect(r.err.title).toBe('refusing to delete without --yes');
    expect(h.calls).toHaveLength(0);
  });

  it('delete --yes deletes', async () => {
    const h = await harness();
    h.reply(jsonResponse(204));
    const r = await h.run('projects', 'delete', '2', '--yes');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/projects/2' });
    expect(r.out).toEqual({ deleted: true, id: 2 });
  });
});
