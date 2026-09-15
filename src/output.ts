import type { AllItems, Page } from './client';

export type Obj = Record<string, any>;
export type Detail = 'list' | 'detail';
export type Trim = (item: Obj) => Obj;

export const ZERO_DATE = '0001-01-01T00:00:00Z';
const ZERO_DATE_MATCH = /^0001-01-01T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function normalizeDates<T>(value: T): T {
  if (typeof value === 'string' && ZERO_DATE_MATCH.test(value)) return null as T;
  if (Array.isArray(value)) return value.map((item) => normalizeDates(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDates(item)])) as T;
  }
  return value;
}

const username = (user: Obj | null | undefined): string | null => user?.username ?? null;

export function trimProject(p: Obj, detail: Detail): Obj {
  const out: Obj = {
    id: p.id,
    title: p.title,
    parent_project_id: p.parent_project_id ?? 0,
    is_archived: p.is_archived ?? false,
  };
  if (detail === 'detail') out.description = p.description ?? '';
  return out;
}

export function trimTask(t: Obj, detail: Detail): Obj {
  const out: Obj = {
    id: t.id,
    title: t.title,
    done: t.done ?? false,
    project_id: t.project_id,
    due_date: t.due_date ?? null,
    priority: t.priority ?? 0,
    labels: ((t.labels ?? []) as Obj[]).map((label) => ({ id: label.id, title: label.title })),
  };
  if (detail === 'detail') {
    Object.assign(out, {
      description: t.description ?? '',
      created: t.created,
      updated: t.updated,
      done_at: t.done_at ?? null,
      created_by: username(t.created_by),
    });
  }
  return out;
}

export function trimLabel(l: Obj): Obj {
  return { id: l.id, title: l.title, hex_color: l.hex_color ?? '' };
}

export function trimComment(c: Obj): Obj {
  return { id: c.id, author: username(c.author), created: c.created, comment: c.comment ?? '' };
}

export function shapeOne(raw: Obj, full: boolean, trim: Trim): Obj {
  const normalized = normalizeDates(raw);
  return full ? normalized : trim(normalized);
}

export function shapeList(res: Page<Obj> | AllItems<Obj>, full: boolean, trim: Trim): Obj {
  const items = (res.items ?? []).map((item) => shapeOne(item, full, trim));
  if ('page' in res) {
    return { items, page: res.page, per_page: res.per_page, total_pages: res.total_pages, total: res.total };
  }
  return res.truncated ? { items, total: res.total, truncated: true } : { items, total: res.total };
}
