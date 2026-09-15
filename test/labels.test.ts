import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const label = { id: 3, title: 'urgent', hex_color: 'e11d48', description: '', created_by: { username: 'trung' } };

describe('labels', () => {
  it('list searches and trims', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { items: [label], page: 1, per_page: 50, total_pages: 1, total: 1 }));
    const r = await h.run('labels', 'list', '--search', 'urg');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/labels?q=urg&page=1&per_page=50');
    expect(r.out.items).toEqual([{ id: 3, title: 'urgent', hex_color: 'e11d48' }]);
  });

  it('create normalizes the color', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, label));
    const r = await h.run('labels', 'create', '--title', 'urgent', '--color', '#E11D48');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/labels',
      body: { title: 'urgent', hex_color: 'e11d48' },
    });
    expect(r.out).toEqual({ id: 3, title: 'urgent', hex_color: 'e11d48' });
  });

  it('create rejects an invalid color before calling the API', async () => {
    const h = await harness();
    const r = await h.run('labels', 'create', '--title', 'x', '--color', 'red');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('delete requires --yes, then deletes', async () => {
    const h = await harness();
    expect((await h.run('labels', 'delete', '3')).code).toBe(2);
    h.reply(jsonResponse(204));
    const r = await h.run('labels', 'delete', '3', '--yes');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/labels/3' });
    expect(r.out).toEqual({ deleted: true, id: 3 });
  });

  it('add attaches a label to a task', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, { label_id: 3, created: '2026-09-15T10:00:00Z' }));
    const r = await h.run('labels', 'add', '5', '3');
    expect(h.calls[0]).toMatchObject({ method: 'POST', url: 'https://vk.test/api/v2/tasks/5/labels', body: { label_id: 3 } });
    expect(r.out).toEqual({ task_id: 5, label_id: 3, added: true });
  });

  it('remove detaches a label from a task', async () => {
    const h = await harness();
    h.reply(jsonResponse(204));
    const r = await h.run('labels', 'remove', '5', '3');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/tasks/5/labels/3' });
    expect(r.out).toEqual({ task_id: 5, label_id: 3, removed: true });
  });

  it('add rejects a non-numeric label id', async () => {
    const h = await harness();
    const r = await h.run('labels', 'add', '5', 'urgent');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
