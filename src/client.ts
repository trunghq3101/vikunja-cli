import type { Connection } from './config';
import { CliError } from './errors';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  page: number;
  per_page: number;
  total_pages: number;
  total: number;
}

export interface AllItems<T> {
  items: T[];
  total: number;
  truncated?: true;
}

export interface ClientOptions {
  connection: Connection;
  token?: string;
  profile?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

export const ALL_ITEMS_CAP = 5000;

const CLOUDFLARE_REJECTED = 'Cloudflare Access rejected the request — check the service token (vikunja setup)';

export function buildUrl(base: string, path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const qs = params.toString();
  return `${base}/api/v2${path}${qs ? `?${qs}` : ''}`;
}

function isCloudflareRejection(res: Response): boolean {
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) {
    try {
      if (new URL(location, 'https://placeholder.invalid').hostname.endsWith('cloudflareaccess.com')) return true;
    } catch {
      // unparseable Location header: fall through to the generic checks
    }
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) return true;
  return res.status === 403 && !type.includes('json');
}

async function apiError(res: Response): Promise<CliError> {
  const text = await res.text();
  try {
    const problem = JSON.parse(text) as { title?: string; message?: string; detail?: string; errors?: unknown[] | null };
    return new CliError(1, problem.title ?? problem.message ?? `HTTP ${res.status}`, {
      status: res.status,
      detail: problem.detail,
      errors: problem.errors ?? undefined,
    });
  } catch {
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return new CliError(1, `HTTP ${res.status}`, { status: res.status, detail: `redirected to ${location}` });
    }
    return new CliError(1, `HTTP ${res.status}`, { status: res.status, detail: text.slice(0, 500) });
  }
}

export class VikunjaClient {
  constructor(private readonly opts: ClientOptions) {}

  async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const { connection, token, profile, fetch: fetchFn = fetch, timeoutMs = 30_000 } = this.opts;
    const url = buildUrl(connection.url, path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      'CF-Access-Client-Id': connection.cfClientId,
      'CF-Access-Client-Secret': connection.cfClientSecret,
      ...options.headers,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = method === 'PATCH' ? 'application/merge-patch+json' : 'application/json';
      body = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await fetchFn(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const e = err as Error;
      const title = e.name === 'TimeoutError' ? `request timed out after ${timeoutMs / 1000}s` : 'network error';
      throw new CliError(1, title, { detail: `${method} ${url}: ${e.message}` });
    }

    if (isCloudflareRejection(res)) throw new CliError(3, CLOUDFLARE_REJECTED, { status: res.status });
    if (res.status === 401) {
      const text = await res.text();
      let message: string | undefined;
      try {
        message = (JSON.parse(text) as { message?: string }).message;
      } catch {
        // non-JSON body: fall back to the generic detail below
      }
      const generic = 'the token may be invalid, expired, or missing a permission for this endpoint';
      throw new CliError(3, `Vikunja rejected the token for profile \`${profile ?? '(none)'}\``, {
        status: 401,
        detail: message ? `${message} — ${generic}` : generic,
      });
    }
    if (!res.ok) throw await apiError(res);
    if (res.status === 204) return undefined as T;
    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      const e = err as Error;
      const title = e.name === 'TimeoutError' ? `request timed out after ${timeoutMs / 1000}s` : 'invalid response from server';
      throw new CliError(1, title, { detail: `${method} ${url}: ${e.message}` });
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new CliError(1, 'invalid response from server', { status: res.status, detail: text.slice(0, 200) });
    }
  }

  listPage<T>(path: string, query: Query): Promise<Page<T>> {
    return this.request<Page<T>>('GET', path, { query });
  }

  async listAll<T>(path: string, query: Query, cap = ALL_ITEMS_CAP): Promise<AllItems<T>> {
    const perPage = Number(query.per_page ?? 50);
    const items: T[] = [];
    let page = 1;
    let total = 0;
    let totalPages = 1;
    do {
      const res = await this.listPage<T>(path, { ...query, page, per_page: perPage });
      items.push(...(res.items ?? []));
      total = res.total;
      totalPages = res.total_pages;
      page += 1;
    } while (page <= totalPages && items.length < cap);
    if (items.length > cap || page <= totalPages) return { items: items.slice(0, cap), total, truncated: true };
    return { items, total };
  }
}
