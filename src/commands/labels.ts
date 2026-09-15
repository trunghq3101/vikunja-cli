import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import { usageError } from '../errors';
import { shapeOne, trimLabel, type Obj } from '../output';
import { listAndShape, parseId, parseListOptions, requireYes, withApi, withList, type ListOptions } from './common';

const HEX_COLOR = /^#?([0-9a-fA-F]{6})$/;

export function registerLabels(program: Command, deps: Deps): void {
  const labels = program.command('labels').description('manage labels and attach them to tasks');

  withList(labels.command('list').description('list labels'))
    .option('--search <q>', 'search text')
    .action(async (opts: ListOptions & { search?: string }) => {
      const params = parseListOptions(opts);
      const { client } = await apiContext(deps, opts);
      print(deps, await listAndShape(client, '/labels', { q: opts.search }, params, trimLabel));
    });

  withApi(labels.command('create').description('create a label (check labels list first)'))
    .requiredOption('--title <title>', 'label title')
    .option('--color <hex>', 'hex color, e.g. e11d48')
    .action(async (opts: ApiOptions & { title: string; color?: string }) => {
      const body: Obj = { title: opts.title };
      if (opts.color !== undefined) {
        const match = HEX_COLOR.exec(opts.color);
        if (!match) throw usageError(`invalid --color: ${opts.color}`, 'expected 6 hex digits, e.g. e11d48');
        body.hex_color = match[1].toLowerCase();
      }
      const { client } = await apiContext(deps, opts);
      const created = await client.request<Obj>('POST', '/labels', { body });
      print(deps, shapeOne(created, Boolean(opts.full), trimLabel));
    });

  withApi(labels.command('delete <id>').description('delete a label'))
    .option('--yes', 'confirm deletion')
    .action(async (id: string, opts: ApiOptions & { yes?: boolean }) => {
      const labelId = parseId(id);
      requireYes(opts.yes);
      const { client } = await apiContext(deps, opts);
      await client.request('DELETE', `/labels/${labelId}`);
      print(deps, { deleted: true, id: labelId });
    });

  withApi(labels.command('add <task-id> <label-id>').description('attach a label to a task')).action(
    async (taskArg: string, labelArg: string, opts: ApiOptions) => {
      const taskId = parseId(taskArg, 'task id');
      const labelId = parseId(labelArg, 'label id');
      const { client } = await apiContext(deps, opts);
      await client.request('POST', `/tasks/${taskId}/labels`, { body: { label_id: labelId } });
      print(deps, { task_id: taskId, label_id: labelId, added: true });
    },
  );

  withApi(labels.command('remove <task-id> <label-id>').description('detach a label from a task')).action(
    async (taskArg: string, labelArg: string, opts: ApiOptions) => {
      const taskId = parseId(taskArg, 'task id');
      const labelId = parseId(labelArg, 'label id');
      const { client } = await apiContext(deps, opts);
      await client.request('DELETE', `/tasks/${taskId}/labels/${labelId}`);
      print(deps, { task_id: taskId, label_id: labelId, removed: true });
    },
  );
}
