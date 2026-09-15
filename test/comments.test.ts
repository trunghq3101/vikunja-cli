import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { DEFAULT_SECRETS, harness } from './harness';

const comment = {
  id: 9,
  comment: 'LGTM **ship it**',
  author: { id: 8, username: 'bot-reviewer' },
  created: '2026-09-15T10:00:00Z',
  updated: '2026-09-15T10:00:00Z',
};

describe('comments', () => {
  it('list reads markdown comments for a task', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { items: [comment], page: 1, per_page: 50, total_pages: 1, total: 1 }));
    const r = await h.run('comments', 'list', '5');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/tasks/5/comments?format=markdown&page=1&per_page=50');
    expect(r.out.items).toEqual([
      { id: 9, author: 'bot-reviewer', created: '2026-09-15T10:00:00Z', comment: 'LGTM **ship it**' },
    ]);
  });

  it('add posts markdown as the chosen profile', async () => {
    const h = await harness({ secrets: { ...DEFAULT_SECRETS, 'profile:reviewer': 'tk_rev' } });
    h.reply(jsonResponse(201, comment));
    const r = await h.run('comments', 'add', '5', '--text', 'LGTM **ship it**', '--as', 'reviewer');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/tasks/5/comments?format=markdown',
      body: { comment: 'LGTM **ship it**' },
    });
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_rev');
    expect(r.out.author).toBe('bot-reviewer');
  });

  it('add requires --text', async () => {
    const h = await harness();
    const r = await h.run('comments', 'add', '5');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
