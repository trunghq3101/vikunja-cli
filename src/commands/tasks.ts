import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { parseDue } from '../dates';
import { usageError } from '../errors';
import { shapeOne, trimTask, type Obj } from '../output';
import {
  listAndShape,
  MARKDOWN,
  parseId,
  parseListOptions,
  parsePriority,
  patchAndReread,
  requireChanges,
  requireYes,
  withApi,
  withList,
  type ListOptions,
} from './common';

const SORT = /^([a-z_]+):(asc|desc)$/;
const detail = (t: Obj) => trimTask(t, 'detail');
const collect = (value: string, previous: string[]) => [...previous, value];

export function parseSorts(values: string[]): { sort_by?: string[]; order_by?: string[] } {
  if (values.length === 0) return {};
  const sort_by: string[] = [];
  const order_by: string[] = [];
  for (const value of values) {
    const match = SORT.exec(value);
    if (!match) throw usageError(`invalid --sort: ${value}`, 'expected FIELD:asc or FIELD:desc, e.g. due_date:asc');
    sort_by.push(match[1]);
    order_by.push(match[2]);
  }
  return { sort_by, order_by };
}

interface TaskFieldOptions {
  title?: string;
  description?: string;
  due?: string;
  priority?: string;
}

function taskFields(opts: TaskFieldOptions, allowNoneDue: boolean): Obj {
  const fields: Obj = {};
  if (opts.title !== undefined) fields.title = opts.title;
  if (opts.description !== undefined) fields.description = opts.description;
  if (opts.due !== undefined) fields.due_date = parseDue(opts.due, allowNoneDue);
  if (opts.priority !== undefined) fields.priority = parsePriority(opts.priority);
  return fields;
}

type TaskListOptions = ListOptions & {
  project?: string;
  filter?: string;
  search?: string;
  sort: string[];
  includeDone?: boolean;
};

export function registerTasks(program: Command, deps: Deps): void {
  const tasks = program.command('tasks').description('manage tasks');

  withList(tasks.command('list').description('list tasks (open tasks unless --filter or --include-done)'))
    .option('--project <id>', 'only tasks in this project')
    .option('--filter <expr>', 'Vikunja filter, e.g. "done = false && due_date < now+7d"')
    .option('--search <q>', 'search text')
    .option('--sort <field:dir>', 'sort, repeatable, e.g. due_date:asc', collect, [])
    .option('--include-done', 'include done tasks (ignored when --filter is given)')
    .action(async (opts: TaskListOptions) => {
      const params = parseListOptions(opts);
      const projectId = opts.project === undefined ? undefined : parseId(opts.project, '--project');
      const sorts = parseSorts(opts.sort);
      const filter = opts.filter ?? (opts.includeDone ? undefined : 'done = false');
      const { client } = await apiContext(deps, opts);
      const path = projectId === undefined ? '/tasks' : `/projects/${projectId}/tasks`;
      const query = { ...MARKDOWN, q: opts.search, filter, ...sorts };
      print(deps, await listAndShape(client, path, query, params, (t) => trimTask(t, 'list')));
    });

  withApi(tasks.command('get <id>').description('show a task')).action(async (id: string, opts: ApiOptions) => {
    const taskId = parseId(id);
    const { client } = await apiContext(deps, opts);
    const task = await client.request<Obj>('GET', `/tasks/${taskId}`, { query: MARKDOWN });
    print(deps, shapeOne(task, Boolean(opts.full), detail));
  });

  withApi(tasks.command('create').description('create a task'))
    .requiredOption('--project <id>', 'project id')
    .requiredOption('--title <title>', 'task title')
    .option('--description <md>', 'description (Markdown)')
    .option('--due <date>', 'due date: YYYY-MM-DD or ISO datetime')
    .option('--priority <0-5>', '0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 do now')
    .action(async (opts: ApiOptions & TaskFieldOptions & { project: string }) => {
      const projectId = parseId(opts.project, '--project');
      const body = taskFields(opts, false);
      const { client } = await apiContext(deps, opts);
      const created = await client.request<Obj>('POST', `/projects/${projectId}/tasks`, { query: MARKDOWN, body });
      print(deps, shapeOne(created, Boolean(opts.full), detail));
    });

  withApi(tasks.command('update <id>').description('change a task (only the given fields)'))
    .option('--title <title>', 'new title')
    .option('--description <md>', 'new description (Markdown)')
    .option('--due <date>', 'due date: YYYY-MM-DD, ISO datetime, or none to clear')
    .option('--priority <0-5>', '0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 do now')
    .action(async (id: string, opts: ApiOptions & TaskFieldOptions) => {
      const taskId = parseId(id);
      const patch = taskFields(opts, true);
      requireChanges(patch, '--title, --description, --due, --priority');
      const { client } = await apiContext(deps, opts);
      print(deps, shapeOne(await patchAndReread(client, `/tasks/${taskId}`, patch), Boolean(opts.full), detail));
    });

  for (const [name, done] of [
    ['done', true],
    ['undone', false],
  ] as const) {
    withApi(tasks.command(`${name} <id>`).description(`mark a task ${name}`)).action(async (id: string, opts: ApiOptions) => {
      const taskId = parseId(id);
      const { client } = await apiContext(deps, opts);
      print(deps, shapeOne(await patchAndReread(client, `/tasks/${taskId}`, { done }), Boolean(opts.full), detail));
    });
  }

  withApi(tasks.command('delete <id>').description('delete a task'))
    .option('--yes', 'confirm deletion')
    .action(async (id: string, opts: ApiOptions & { yes?: boolean }) => {
      const taskId = parseId(id);
      requireYes(opts.yes);
      const { client } = await apiContext(deps, opts);
      await client.request('DELETE', `/tasks/${taskId}`);
      print(deps, { deleted: true, id: taskId });
    });
}
