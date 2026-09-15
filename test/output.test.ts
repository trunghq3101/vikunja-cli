import { describe, expect, it } from 'vitest';
import { normalizeDates, shapeList, shapeOne, trimComment, trimLabel, trimProject, trimTask } from '../src/output';

const rawTask = {
  $schema: 'https://vk.test/api/v2/schemas/Task.json',
  id: 5,
  title: 'Write spec',
  description: '**bold**',
  done: false,
  done_at: '0001-01-01T00:00:00Z',
  due_date: '2026-09-20T23:59:59+07:00',
  priority: 3,
  project_id: 2,
  created: '2026-09-15T10:00:00+07:00',
  updated: '2026-09-15T11:00:00+07:00',
  created_by: { id: 7, username: 'bot-planner', name: 'Planner' },
  labels: [{ id: 1, title: 'urgent', hex_color: 'e11d48', created: '2026-01-01T00:00:00Z' }],
  percent_done: 0,
};

describe('normalizeDates', () => {
  it('turns zero dates into null at any depth and keeps everything else', () => {
    expect(
      normalizeDates({
        a: '0001-01-01T00:00:00Z',
        b: '0001-01-01T00:00:00+00:00',
        c: '2026-09-15T10:00:00+07:00',
        list: [{ d: '0001-01-01T00:00:00Z' }],
        n: 0,
        s: null,
      }),
    ).toEqual({ a: null, b: null, c: '2026-09-15T10:00:00+07:00', list: [{ d: null }], n: 0, s: null });
  });

  it('leaves strings that merely start with the zero-date prefix unchanged', () => {
    expect(normalizeDates('0001-01-01T is not a date')).toBe('0001-01-01T is not a date');
  });
});

describe('trimmers', () => {
  it('trimTask list view', () => {
    expect(trimTask(normalizeDates(rawTask), 'list')).toEqual({
      id: 5,
      title: 'Write spec',
      done: false,
      project_id: 2,
      due_date: '2026-09-20T23:59:59+07:00',
      priority: 3,
      labels: [{ id: 1, title: 'urgent' }],
    });
  });

  it('trimTask detail view', () => {
    expect(trimTask(normalizeDates(rawTask), 'detail')).toEqual({
      id: 5,
      title: 'Write spec',
      done: false,
      project_id: 2,
      due_date: '2026-09-20T23:59:59+07:00',
      priority: 3,
      labels: [{ id: 1, title: 'urgent' }],
      description: '**bold**',
      created: '2026-09-15T10:00:00+07:00',
      updated: '2026-09-15T11:00:00+07:00',
      done_at: null,
      created_by: 'bot-planner',
    });
  });

  it('trimTask tolerates null labels and missing optional fields', () => {
    expect(trimTask({ id: 1, title: 't', project_id: 2, labels: null }, 'list')).toEqual({
      id: 1,
      title: 't',
      done: false,
      project_id: 2,
      due_date: null,
      priority: 0,
      labels: [],
    });
  });

  it('trimProject list and detail', () => {
    const raw = { id: 2, title: 'Home', description: 'desc', parent_project_id: 0, is_archived: false, hex_color: '' };
    expect(trimProject(raw, 'list')).toEqual({ id: 2, title: 'Home', parent_project_id: 0, is_archived: false });
    expect(trimProject(raw, 'detail')).toEqual({ id: 2, title: 'Home', parent_project_id: 0, is_archived: false, description: 'desc' });
  });

  it('trimLabel and trimComment', () => {
    expect(trimLabel({ id: 1, title: 'urgent', hex_color: 'e11d48', created_by: { username: 'x' } })).toEqual({
      id: 1,
      title: 'urgent',
      hex_color: 'e11d48',
    });
    expect(
      trimComment({ id: 9, comment: 'hi', author: { username: 'bot-reviewer' }, created: '2026-09-15T10:00:00Z', updated: 'x' }),
    ).toEqual({ id: 9, author: 'bot-reviewer', created: '2026-09-15T10:00:00Z', comment: 'hi' });
  });
});

describe('shapeOne / shapeList', () => {
  it('full output keeps every field but still normalizes dates', () => {
    const out = shapeOne(rawTask, true, (t) => trimTask(t, 'list'));
    expect(out.percent_done).toBe(0);
    expect(out.done_at).toBeNull();
  });

  it('page result keeps pagination fields and drops $schema', () => {
    const page = { $schema: 'x', items: [rawTask], page: 1, per_page: 50, total_pages: 1, total: 1 };
    expect(shapeList(page as never, false, (t) => trimTask(t, 'list'))).toEqual({
      items: [trimTask(normalizeDates(rawTask), 'list')],
      page: 1,
      per_page: 50,
      total_pages: 1,
      total: 1,
    });
  });

  it('all-items result keeps total and truncated', () => {
    expect(shapeList({ items: [], total: 9000, truncated: true }, false, trimLabel)).toEqual({ items: [], total: 9000, truncated: true });
    expect(shapeList({ items: [], total: 0 }, false, trimLabel)).toEqual({ items: [], total: 0 });
  });
});
