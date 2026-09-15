import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { shapeOne, trimProject, type Obj } from '../output';
import {
  listAndShape,
  MARKDOWN,
  parseId,
  parseListOptions,
  patchAndReread,
  requireChanges,
  requireYes,
  withApi,
  withList,
  type ListOptions,
} from './common';

const detail = (p: Obj) => trimProject(p, 'detail');

export function registerProjects(program: Command, deps: Deps): void {
  const projects = program.command('projects').description('manage projects');

  withList(projects.command('list').description('list projects'))
    .option('--archived', 'include archived projects')
    .option('--search <q>', 'search text')
    .action(async (opts: ListOptions & { archived?: boolean; search?: string }) => {
      const params = parseListOptions(opts);
      const { client } = await apiContext(deps, opts);
      const query = { ...MARKDOWN, q: opts.search, is_archived: opts.archived ? true : undefined };
      print(deps, await listAndShape(client, '/projects', query, params, (p) => trimProject(p, 'list')));
    });

  withApi(projects.command('get <id>').description('show a project')).action(async (id: string, opts: ApiOptions) => {
    const projectId = parseId(id);
    const { client } = await apiContext(deps, opts);
    const project = await client.request<Obj>('GET', `/projects/${projectId}`, { query: MARKDOWN });
    print(deps, shapeOne(project, Boolean(opts.full), detail));
  });

  withApi(projects.command('create').description('create a project'))
    .requiredOption('--title <title>', 'project title')
    .option('--description <md>', 'description (Markdown)')
    .option('--parent <id>', 'parent project id')
    .action(async (opts: ApiOptions & { title: string; description?: string; parent?: string }) => {
      const body: Obj = { title: opts.title };
      if (opts.description !== undefined) body.description = opts.description;
      if (opts.parent !== undefined) body.parent_project_id = parseId(opts.parent, '--parent');
      const { client } = await apiContext(deps, opts);
      const created = await client.request<Obj>('POST', '/projects', { query: MARKDOWN, body });
      print(deps, shapeOne(created, Boolean(opts.full), detail));
    });

  withApi(projects.command('update <id>').description('change a project'))
    .option('--title <title>', 'new title')
    .option('--description <md>', 'new description (Markdown)')
    .action(async (id: string, opts: ApiOptions & { title?: string; description?: string }) => {
      const projectId = parseId(id);
      const patch: Obj = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.description !== undefined) patch.description = opts.description;
      requireChanges(patch, '--title, --description');
      const { client } = await apiContext(deps, opts);
      print(deps, shapeOne(await patchAndReread(client, `/projects/${projectId}`, patch), Boolean(opts.full), detail));
    });

  for (const [name, archived] of [
    ['archive', true],
    ['unarchive', false],
  ] as const) {
    withApi(projects.command(`${name} <id>`).description(`${name} a project`)).action(async (id: string, opts: ApiOptions) => {
      const projectId = parseId(id);
      const { client } = await apiContext(deps, opts);
      const project = await patchAndReread(client, `/projects/${projectId}`, { is_archived: archived });
      print(deps, shapeOne(project, Boolean(opts.full), detail));
    });
  }

  withApi(projects.command('delete <id>').description('delete a project and its tasks'))
    .option('--yes', 'confirm deletion')
    .action(async (id: string, opts: ApiOptions & { yes?: boolean }) => {
      const projectId = parseId(id);
      requireYes(opts.yes);
      const { client } = await apiContext(deps, opts);
      await client.request('DELETE', `/projects/${projectId}`);
      print(deps, { deleted: true, id: projectId });
    });
}
