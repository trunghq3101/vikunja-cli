import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const bucket = { id: 21, title: 'Doing', limit: 0, position: 2, project_view_id: 8, count: 3, created_by: { username: 'trung' } };
const page = (items: unknown[]) => jsonResponse(200, { items, page: 1, per_page: 50, total_pages: 1, total: items.length });
const view = (id: number, title: string, view_kind: string) => ({ id, title, view_kind, project_id: 4 });

describe('buckets list', () => {
  it('lists the buckets of the given view', async () => {
    const h = await harness();
    h.reply(page([bucket]));
    const r = await h.run('buckets', 'list', '--project', '4', '--view', '8');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/projects/4/views/8/buckets?page=1&per_page=50');
    expect(r.out.items).toEqual([{ id: 21, title: 'Doing', limit: 0 }]);
  });

  it("without --view uses the project's only kanban view", async () => {
    const h = await harness();
    h.reply(page([view(7, 'List', 'list'), view(8, 'Kanban', 'kanban')]), page([bucket]));
    const r = await h.run('buckets', 'list', '--project', '4');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/projects/4/views?page=1&per_page=50');
    expect(h.calls[1].url).toBe('https://vk.test/api/v2/projects/4/views/8/buckets?page=1&per_page=50');
    expect(r.out.items).toHaveLength(1);
  });

  it('asks for --view when the project has several kanban views', async () => {
    const h = await harness();
    h.reply(page([view(8, 'Kanban', 'kanban'), view(9, 'Sprint', 'kanban')]));
    const r = await h.run('buckets', 'list', '--project', '4');
    expect(r.code).toBe(2);
    expect(r.err.detail).toBe('pass --view with one of: 8 (Kanban), 9 (Sprint)');
    expect(h.calls).toHaveLength(1);
  });

  it('fails when the project has no kanban view', async () => {
    const h = await harness();
    h.reply(page([view(7, 'List', 'list')]));
    const r = await h.run('buckets', 'list', '--project', '4');
    expect(r.code).toBe(1);
    expect(r.err.title).toBe('project 4 has no kanban view');
  });

  it('requires --project', async () => {
    const h = await harness();
    expect((await h.run('buckets', 'list', '--view', '8')).code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('buckets create', () => {
  it('posts the title and limit to the view', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, { ...bucket, limit: 5 }));
    const r = await h.run('buckets', 'create', '--project', '4', '--view', '8', '--title', 'Doing', '--limit', '5');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/projects/4/views/8/buckets',
      body: { title: 'Doing', limit: 5 },
    });
    expect(r.out).toEqual({ id: 21, title: 'Doing', limit: 5 });
  });

  it('resolves the kanban view when --view is omitted', async () => {
    const h = await harness();
    h.reply(page([view(8, 'Kanban', 'kanban')]), jsonResponse(201, bucket));
    await h.run('buckets', 'create', '--project', '4', '--title', 'Doing');
    expect(h.calls[1]).toMatchObject({ url: 'https://vk.test/api/v2/projects/4/views/8/buckets', body: { title: 'Doing' } });
  });

  it('rejects an invalid --limit before calling the API', async () => {
    const h = await harness();
    const r = await h.run('buckets', 'create', '--project', '4', '--view', '8', '--title', 'x', '--limit', 'many');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
