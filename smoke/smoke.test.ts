import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { VikunjaClient } from '../src/client';
import { loadConfig, resolveConnection } from '../src/config';
import { securityKeychain } from '../src/keychain';

const execFileAsync = promisify(execFile);
const PROFILE = process.env.SMOKE_PROFILE;

// Every method + path (as written in the OpenAPI spec) that the CLI calls.
const USED_ENDPOINTS: Array<[string, string]> = [
  ['get', '/info'],
  ['get', '/user'],
  ['get', '/projects'],
  ['post', '/projects'],
  ['get', '/projects/{id}'],
  ['patch', '/projects/{id}'],
  ['delete', '/projects/{id}'],
  ['get', '/tasks'],
  ['get', '/projects/{project}/tasks'],
  ['post', '/projects/{project}/tasks'],
  ['get', '/tasks/{projecttask}'],
  ['patch', '/tasks/{projecttask}'],
  ['delete', '/tasks/{projecttask}'],
  ['get', '/labels'],
  ['post', '/labels'],
  ['delete', '/labels/{id}'],
  ['post', '/tasks/{projecttask}/labels'],
  ['delete', '/tasks/{projecttask}/labels/{label}'],
  ['get', '/tasks/{task}/comments'],
  ['post', '/tasks/{task}/comments'],
];

async function api(...args: string[]) {
  try {
    const { stdout } = await execFileAsync('node', ['plugin/bin/vikunja', ...args, '--as', PROFILE!]);
    return JSON.parse(stdout);
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    throw new Error(`vikunja ${args.join(' ')} failed (exit ${e.code}): ${e.stderr}`);
  }
}

describe.runIf(Boolean(PROFILE))('live smoke test', () => {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  let projectId: number | undefined;
  let labelId: number | undefined;

  afterAll(async () => {
    if (labelId) await api('labels', 'delete', String(labelId), '--yes').catch(() => undefined);
    if (projectId) await api('projects', 'delete', String(projectId), '--yes').catch(() => undefined);
  });

  it('every endpoint the CLI uses exists in the server OpenAPI spec', async () => {
    const connection = await resolveConnection(process.env, securityKeychain(), await loadConfig(process.env));
    const spec = await new VikunjaClient({ connection }).request<{ paths: Record<string, Record<string, unknown>> }>(
      'GET',
      '/openapi.json',
    );
    expect(USED_ENDPOINTS.filter(([method, path]) => !spec.paths[path]?.[method])).toEqual([]);
  });

  it('whoami resolves the bot profile', async () => {
    const me = await api('whoami');
    expect(me.profile).toBe(PROFILE);
    expect(me.username).toBeTruthy();
  });

  it('round-trips projects, tasks, labels and comments', async () => {
    const project = await api('projects', 'create', '--title', `vikunja-cli-smoke-${stamp}`, '--description', 'smoke **test**');
    projectId = project.id;
    expect(project.description).toContain('**test**');
    const pid = String(projectId);

    const created = await api(
      'tasks', 'create', '--project', pid, '--title', 'smoke task',
      '--description', '# Heading\n\n- item', '--due', '2030-01-15', '--priority', '3',
    );
    expect(created).toMatchObject({ title: 'smoke task', priority: 3, done: false });
    expect(created.due_date).toMatch(/^2030-01-1[56]T/);
    expect(created.description).toContain('# Heading');
    const taskId = String(created.id);

    const renamed = await api('tasks', 'update', taskId, '--title', 'smoke task renamed');
    expect(renamed.title).toBe('smoke task renamed');
    expect(renamed.priority).toBe(3);
    expect(renamed.description).toContain('# Heading');

    expect((await api('tasks', 'done', taskId)).done).toBe(true);
    expect((await api('tasks', 'undone', taskId)).done).toBe(false);

    const cleared = await api('tasks', 'update', taskId, '--due', 'none');
    expect(cleared.due_date).toBeNull();

    const listed = await api('tasks', 'list', '--project', pid);
    expect(listed.items.map((t: { id: number }) => t.id)).toContain(created.id);

    const label = await api('labels', 'create', '--title', `smoke-${stamp}`, '--color', 'e11d48');
    labelId = label.id;
    await api('labels', 'add', taskId, String(labelId));
    expect((await api('tasks', 'get', taskId)).labels).toEqual([{ id: labelId, title: `smoke-${stamp}` }]);
    await api('labels', 'remove', taskId, String(labelId));
    expect((await api('tasks', 'get', taskId)).labels).toEqual([]);

    const comment = await api('comments', 'add', taskId, '--text', 'Looks **good**');
    expect(comment.comment).toContain('**good**');
    const comments = await api('comments', 'list', taskId);
    expect(comments.items.map((c: { id: number }) => c.id)).toContain(comment.id);

    expect((await api('projects', 'archive', pid)).is_archived).toBe(true);
    expect((await api('projects', 'unarchive', pid)).is_archived).toBe(false);
  });
});
