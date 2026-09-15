import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { shapeOne, trimComment, type Obj } from '../output';
import { listAndShape, MARKDOWN, parseId, parseListOptions, withApi, withList, type ListOptions } from './common';

export function registerComments(program: Command, deps: Deps): void {
  const comments = program.command('comments').description('read and add task comments');

  withList(comments.command('list <task-id>').description('list comments on a task')).action(
    async (taskArg: string, opts: ListOptions) => {
      const taskId = parseId(taskArg, 'task id');
      const params = parseListOptions(opts);
      const { client } = await apiContext(deps, opts);
      print(deps, await listAndShape(client, `/tasks/${taskId}/comments`, MARKDOWN, params, trimComment));
    },
  );

  withApi(comments.command('add <task-id>').description('add a comment to a task'))
    .requiredOption('--text <md>', 'comment text (Markdown)')
    .action(async (taskArg: string, opts: ApiOptions & { text: string }) => {
      const taskId = parseId(taskArg, 'task id');
      const { client } = await apiContext(deps, opts);
      const created = await client.request<Obj>('POST', `/tasks/${taskId}/comments`, {
        query: MARKDOWN,
        body: { comment: opts.text },
      });
      print(deps, shapeOne(created, Boolean(opts.full), trimComment));
    });
}
