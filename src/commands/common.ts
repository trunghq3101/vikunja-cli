import type { Command } from 'commander';
import type { Query, VikunjaClient } from '../client';
import type { ApiOptions } from '../context';
import { usageError } from '../errors';
import { shapeList, type Obj, type Trim } from '../output';

export const MARKDOWN = { format: 'markdown' };

export interface ListOptions extends ApiOptions {
  page?: string;
  perPage?: string;
  all?: boolean;
}

export interface ListParams {
  all: boolean;
  page: number;
  perPage: number;
  full: boolean;
}

export function withApi(cmd: Command): Command {
  return cmd
    .option('--as <profile>', 'act as this Vikunja profile')
    .option('--full', 'print the complete API object');
}

export function withList(cmd: Command): Command {
  return withApi(cmd)
    .option('--page <n>', 'page number (default 1)')
    .option('--per-page <n>', 'items per page (default 50, max 1000)')
    .option('--all', 'fetch every page (max 5000 items)');
}

export function parseId(value: string, what = 'id'): number {
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`invalid ${what}: ${value}`, 'expected a positive integer');
  return Number(value);
}

export function parsePriority(value: string): number {
  if (!/^[0-5]$/.test(value)) throw usageError(`invalid --priority: ${value}`, 'expected an integer from 0 to 5');
  return Number(value);
}

export function requireYes(yes: boolean | undefined): void {
  if (!yes) throw usageError('refusing to delete without --yes');
}

export function requireChanges(patch: Obj, flags: string): void {
  if (Object.keys(patch).length === 0) throw usageError('nothing to update', `pass at least one of ${flags}`);
}

export function parseListOptions(opts: ListOptions): ListParams {
  const perPage = opts.perPage === undefined ? 50 : parseId(opts.perPage, '--per-page');
  if (perPage > 1000) throw usageError(`invalid --per-page: ${perPage}`, 'maximum is 1000');
  const page = opts.page === undefined ? 1 : parseId(opts.page, '--page');
  return { all: Boolean(opts.all), page, perPage, full: Boolean(opts.full) };
}

export async function listAndShape(
  client: VikunjaClient,
  path: string,
  query: Query,
  params: ListParams,
  trim: Trim,
): Promise<Obj> {
  if (params.all) {
    return shapeList(await client.listAll<Obj>(path, { ...query, per_page: params.perPage }), params.full, trim);
  }
  const res = await client.listPage<Obj>(path, { ...query, page: params.page, per_page: params.perPage });
  return shapeList(res, params.full, trim);
}

// A PATCH round-trips the whole resource, so the markdown header is only safe when the
// description itself is being replaced. The re-read makes the printed result Markdown.
export async function patchAndReread(client: VikunjaClient, path: string, patch: Obj): Promise<Obj> {
  const headers = 'description' in patch ? { 'X-Vikunja-Format': 'markdown' } : undefined;
  await client.request('PATCH', path, { body: patch, headers });
  return client.request<Obj>('GET', path, { query: MARKDOWN });
}
