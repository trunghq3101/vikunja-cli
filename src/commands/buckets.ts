import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { shapeOne, trimBucket, type Obj } from '../output';
import { listAndShape, parseId, parseListOptions, resolveKanbanView, withApi, withList, type ListOptions } from './common';

interface ViewOptions {
  project: string;
  view?: string;
}

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
    .action(async (opts: ListOptions & ViewOptions) => {
      const params = parseListOptions(opts);
      const { projectId, viewId } = parseView(opts);
      const { client } = await apiContext(deps, opts);
      const view = await resolveKanbanView(client, projectId, viewId);
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
