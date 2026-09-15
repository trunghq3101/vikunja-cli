import type { Keychain } from '../src/keychain';
import type { FetchFn } from '../src/client';

export function memoryKeychain(initial: Record<string, string> = {}): Keychain & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    async get(account) {
      return items.get(account) ?? null;
    },
    async set(account, secret) {
      items.set(account, secret);
    },
    async delete(account) {
      items.delete(account);
    },
  };
}

export interface FetchCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

export function fakeFetch(...responses: Array<Response | Error>) {
  const calls: FetchCall[] = [];
  const pending = [...responses];
  const fn: FetchFn = async (url, init) => {
    calls.push({
      method: String(init.method),
      url,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      init,
    });
    const next = pending.shift();
    if (next === undefined) throw new Error(`unexpected request: ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls, queue: (...more: Array<Response | Error>) => void pending.push(...more) };
}

export function jsonResponse(status: number, data?: unknown, contentType = 'application/json'): Response {
  const body = status === 204 || data === undefined ? null : JSON.stringify(data);
  return new Response(body, { status, headers: { 'content-type': contentType } });
}
