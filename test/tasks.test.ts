import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const task = {
  id: 5,
  title: 'Write spec',
  description: 'hello',
  done: false,
  done_at: '0001-01-01T00:00:00Z',
  due_date: '0001-01-01T00:00:00Z',
  priority: 2,
  project_id: 4,
  created: '2026-09-15T10:00:00Z',
  updated: '2026-09-15T10:00:00Z',
  created_by: { id: 1, username: 'trung' },
  labels: null,
};
const page = (items: unknown[]) => jsonResponse(200, { items, page: 1, per_page: 50, total_pages: 1, total: items.length });
const url = (u: string) => new URL(u);

describe('tasks list', () => {
  it('defaults to open tasks across all projects', async () => {
    const h = await harness();
    h.reply(page([task]));
    const r = await h.run('tasks', 'list');
    const u = url(h.calls[0].url);
    expect(u.pathname).toBe('/api/v2/tasks');
    expect(u.searchParams.get('filter')).toBe('done = false');
    expect(u.searchParams.get('format')).toBe('markdown');
    expect(u.searchParams.has('sort_by')).toBe(false);
    expect(r.out.items).toEqual([
      { id: 5, title: 'Write spec', done: false, project_id: 4, due_date: null, priority: 2, labels: [] },
    ]);
  });

  it('--project scopes to one project', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--project', '4');
    expect(url(h.calls[0].url).pathname).toBe('/api/v2/projects/4/tasks');
  });

  it('--filter is sent as-is without the implicit done filter', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--filter', 'priority >= 3 && due_date < now+7d');
    expect(url(h.calls[0].url).searchParams.getAll('filter')).toEqual(['priority >= 3 && due_date < now+7d']);
  });

  it('--include-done drops the implicit filter', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--include-done');
    expect(url(h.calls[0].url).searchParams.has('filter')).toBe(false);
  });

  it('--sort is repeatable and paired', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--sort', 'due_date:asc', '--sort', 'id:desc', '--search', 'spec');
    const q = url(h.calls[0].url).searchParams;
    expect(q.getAll('sort_by')).toEqual(['due_date', 'id']);
    expect(q.getAll('order_by')).toEqual(['asc', 'desc']);
    expect(q.get('q')).toBe('spec');
  });

  it('rejects a malformed --sort before calling the API', async () => {
    const h = await harness();
    const r = await h.run('tasks', 'list', '--sort', 'due_date');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('tasks get/create', () => {
  it('an API error gives exit 1 and prints nothing to stdout', async () => {
    const h = await harness();
    h.reply(jsonResponse(404, { title: 'Not Found', status: 404 }, 'application/problem+json'));
    const r = await h.run('tasks', 'get', '5');
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.err.title).toBe('Not Found');
  });

  it('get prints the detail view', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task));
    const r = await h.run('tasks', 'get', '5');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/tasks/5?format=markdown');
    expect(r.out).toMatchObject({ id: 5, description: 'hello', done_at: null, created_by: 'trung' });
  });

  it('create posts all fields to the project', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, task));
    await h.run(
      'tasks', 'create', '--project', '4', '--title', 'Write spec', '--description', '# Hi',
      '--due', '2026-09-20T09:00:00Z', '--priority', '3',
    );
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/projects/4/tasks?format=markdown',
      body: { title: 'Write spec', description: '# Hi', due_date: '2026-09-20T09:00:00Z', priority: 3 },
    });
  });

  it('create requires --project', async () => {
    const h = await harness();
    const r = await h.run('tasks', 'create', '--title', 'x');
    expect(r.code).toBe(2);
    expect(r.err.title).toContain('--project');
  });

  it('create rejects an out-of-range priority and --due none', async () => {
    const h = await harness();
    expect((await h.run('tasks', 'create', '--project', '4', '--title', 'x', '--priority', '7')).code).toBe(2);
    expect((await h.run('tasks', 'create', '--project', '4', '--title', 'x', '--due', 'none')).code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('tasks update/done/delete', () => {
  it('update --due none clears the date, sends no format header, and re-reads', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task), jsonResponse(200, task));
    const r = await h.run('tasks', 'update', '5', '--due', 'none', '--title', 'New');
    expect(h.calls[0]).toMatchObject({ method: 'PATCH', url: 'https://vk.test/api/v2/tasks/5', body: { title: 'New', due_date: null } });
    expect(h.calls[0].headers['X-Vikunja-Format']).toBeUndefined();
    expect(h.calls[1].url).toBe('https://vk.test/api/v2/tasks/5?format=markdown');
    expect(r.out.due_date).toBeNull();
  });

  it('update --description sends the markdown header', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task), jsonResponse(200, task));
    await h.run('tasks', 'update', '5', '--description', 'new');
    expect(h.calls[0].headers['X-Vikunja-Format']).toBe('markdown');
  });

  it('update with nothing to change is exit 2', async () => {
    const h = await harness();
    expect((await h.run('tasks', 'update', '5')).code).toBe(2);
  });

  it('done and undone patch the done flag', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task), jsonResponse(200, { ...task, done: true }));
    const done = await h.run('tasks', 'done', '5');
    h.reply(jsonResponse(200, task), jsonResponse(200, task));
    await h.run('tasks', 'undone', '5');
    expect(h.calls[0].body).toEqual({ done: true });
    expect(done.out.done).toBe(true);
    expect(h.calls[2].body).toEqual({ done: false });
  });

  it('delete requires --yes, then deletes', async () => {
    const h = await harness();
    expect((await h.run('tasks', 'delete', '5')).code).toBe(2);
    h.reply(jsonResponse(204));
    const r = await h.run('tasks', 'delete', '5', '--yes');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/tasks/5' });
    expect(r.out).toEqual({ deleted: true, id: 5 });
  });
});
