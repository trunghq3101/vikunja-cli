import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { usageError } from '../errors';
import { shapeOne, trimBucket, trimTask, type Obj } from '../output';
import {
  listAndShape,
  MARKDOWN,
  parseId,
  parseListOptions,
  resolveKanbanView,
  withApi,
  withList,
  type ListOptions,
} from './common';

interface ViewOptions {
  project: string;
  view?: string;
}

const withTasks = (b: Obj): Obj => ({
  ...trimBucket(b),
  count: b.count ?? 0,
  tasks: ((b.tasks ?? []) as Obj[]).map((t) => trimTask(t, 'list')),
});

function parseView(opts: ViewOptions): { projectId: number; viewId?: number } {
  const projectId = parseId(opts.project, '--project');
  const viewId = opts.view === undefined ? undefined : parseId(opts.view, '--view');
  return { projectId, viewId };
}

export function registerBuckets(program: Command, deps: Deps): void {
  const buckets = program.command('buckets').description("manage a project's kanban buckets");

  withList(buckets.command('list').description('list the buckets of a kanban view'))
    .requiredOption('--project <id>', 'project id')
    .option('--view <id>', "kanban view id (default: the project's only kanban view)")
    .option('--tasks', 'include the tasks in each bucket (not paginated)')
    .action(async (opts: ListOptions & ViewOptions & { tasks?: boolean }) => {
      const params = parseListOptions(opts);
      const { projectId, viewId } = parseView(opts);
      if (opts.tasks && (opts.page !== undefined || opts.perPage !== undefined || opts.all)) {
        throw usageError('--tasks cannot be combined with --page, --per-page or --all', 'it always returns every bucket');
      }
      const { client } = await apiContext(deps, opts);
      const view = await resolveKanbanView(client, projectId, viewId);
      if (opts.tasks) {
        const path = `/projects/${projectId}/views/${view}/buckets/tasks`;
        const res = await client.request<{ items: Obj[] | null; total: number }>('GET', path, { query: MARKDOWN });
        const items = (res.items ?? []).map((b) => shapeOne(b, Boolean(opts.full), withTasks));
        print(deps, { items, total: res.total ?? items.length });
        return;
      }
      print(deps, await listAndShape(client, `/projects/${projectId}/views/${view}/buckets`, {}, params, trimBucket));
    });

  withApi(buckets.command('create').description('create a bucket (check buckets list first)'))
    .requiredOption('--project <id>', 'project id')
    .option('--view <id>', "kanban view id (default: the project's only kanban view)")
    .requiredOption('--title <title>', 'bucket title')
    .option('--limit <n>', 'maximum number of tasks in the bucket')
    .action(async (opts: ApiOptions & ViewOptions & { title: string; limit?: string }) => {
      const { projectId, viewId } = parseView(opts);
      const body: Obj = { title: opts.title };
      if (opts.limit !== undefined) body.limit = parseId(opts.limit, '--limit');
      const { client } = await apiContext(deps, opts);
      const view = await resolveKanbanView(client, projectId, viewId);
      const created = await client.request<Obj>('POST', `/projects/${projectId}/views/${view}/buckets`, { body });
      print(deps, shapeOne(created, Boolean(opts.full), trimBucket));
    });
}
