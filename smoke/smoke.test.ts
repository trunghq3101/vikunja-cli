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
  ['delete', '/tasks/{task}/comments/{commentid}'],
  ['get', '/projects/{project}/views'],
  ['get', '/projects/{project}/views/{view}/buckets'],
  ['post', '/projects/{project}/views/{view}/buckets'],
  ['put', '/projects/{project}/views/{view}/buckets/{bucket}/tasks'],
  ['get', '/projects/{project}/views/{view}/buckets/tasks'],
];

// Path parameter names differ between server versions ({projecttask} vs {task}); only the shape matters.
const shape = (path: string) => path.replace(/\{[^}]+\}/g, '{}');

async function api(...args: string[]) {
  try {
    const { stdout } = await execFileAsync('node', ['plugin/bin/vikunja', ...args, '--as', PROFILE!]);
    return JSON.parse(stdout);
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    throw new Error(`vikunja ${args.join(' ')} failed (exit ${e.code}): ${e.stderr}`);
  }
}

// For commands expected to fail: returns the exit code and stderr instead of throwing.
async function apiFail(...args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    await execFileAsync('node', ['plugin/bin/vikunja', ...args, '--as', PROFILE!]);
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    return { code: e.code ?? -1, stderr: e.stderr ?? '' };
  }
  throw new Error(`vikunja ${args.join(' ')} unexpectedly succeeded`);
}

describe.runIf(Boolean(PROFILE))('live smoke test', () => {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  let projectId: number | undefined;
  let otherProjectId: number | undefined;
  let labelId: number | undefined;

  afterAll(async () => {
    if (labelId) {
      await api('labels', 'delete', String(labelId), '--yes').catch((err) =>
        console.warn(`smoke cleanup: could not delete label ${labelId}: ${(err as Error).message}`),
      );
    }
    if (otherProjectId) {
      await api('projects', 'delete', String(otherProjectId), '--yes').catch((err) =>
        console.warn(`smoke cleanup: could not delete project ${otherProjectId}: ${(err as Error).message}`),
      );
    }
    if (projectId) {
      await api('projects', 'delete', String(projectId), '--yes').catch((err) =>
        console.warn(`smoke cleanup: could not delete project ${projectId}: ${(err as Error).message}`),
      );
    }
  });

  it('every endpoint the CLI uses exists in the server OpenAPI spec', async () => {
    const connection = await resolveConnection(process.env, securityKeychain(), await loadConfig(process.env));
    const spec = await new VikunjaClient({ connection }).request<{ paths: Record<string, Record<string, unknown>> }>(
      'GET',
      '/openapi.json',
    );
    const paths = new Map(Object.entries(spec.paths).map(([path, ops]) => [shape(path), ops]));
    expect(USED_ENDPOINTS.filter(([method, path]) => !paths.get(shape(path))?.[method])).toEqual([]);
  });

  it('whoami resolves the bot profile', async () => {
    const me = await api('whoami');
    expect(me.profile).toBe(PROFILE);
    expect(me.username).toBeTruthy();
  });

  it('round-trips projects, tasks, buckets, labels and comments', async () => {
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

    // Real newlines (like the create step), to catch server-side Markdown quirks the escaped form would hide.
    const redescribed = await api('tasks', 'update', taskId, '--description', '## New\n\n- x');
    expect((await api('tasks', 'get', taskId)).description).toContain('## New');
    expect(redescribed.description).toContain('- x');

    expect((await api('tasks', 'done', taskId)).done).toBe(true);
    expect((await api('tasks', 'undone', taskId)).done).toBe(false);

    const cleared = await api('tasks', 'update', taskId, '--due', 'none');
    expect(cleared.due_date).toBeNull();

    const listed = await api('tasks', 'list', '--project', pid);
    expect(listed.items.map((t: { id: number }) => t.id)).toContain(created.id);

    const low = await api('tasks', 'create', '--project', pid, '--title', 'smoke task low priority', '--priority', '1');
    const sorted = await api('tasks', 'list', '--project', pid, '--include-done', '--sort', 'priority:desc');
    const priorities = sorted.items.map((t: { priority: number }) => t.priority);
    expect(priorities[0]).toBeGreaterThanOrEqual(priorities[priorities.length - 1]);
    expect(sorted.items.map((t: { id: number }) => t.id)).toContain(low.id);

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
    await api('comments', 'delete', taskId, String(comment.id), '--yes');
    expect((await api('comments', 'list', taskId)).items.map((c: { id: number }) => c.id)).not.toContain(comment.id);

    const bucket = await api('buckets', 'create', '--project', pid, '--title', 'smoke bucket', '--limit', '3');
    expect(bucket).toMatchObject({ title: 'smoke bucket', limit: 3 });
    const buckets = await api('buckets', 'list', '--project', pid);
    expect(buckets.items.map((b: { id: number }) => b.id)).toContain(bucket.id);
    const bucketed = await api('tasks', 'move', taskId, '--bucket', String(bucket.id));
    expect(bucketed).toMatchObject({ id: created.id, bucket_id: bucket.id });
    const board = await api('buckets', 'list', '--project', pid, '--tasks');
    const inBucket = board.items.find((b: { id: number }) => b.id === bucket.id);
    expect(inBucket.tasks.map((t: { id: number }) => t.id)).toContain(created.id);

    const other = await api('projects', 'create', '--title', `vikunja-cli-smoke-${stamp}-other`);
    otherProjectId = other.id;
    expect((await api('tasks', 'move', taskId, '--project', String(otherProjectId))).project_id).toBe(otherProjectId);
    expect((await api('tasks', 'get', taskId)).project_id).toBe(otherProjectId);

    const redescribedProject = await api('projects', 'update', pid, '--description', 'proj **updated**');
    expect(redescribedProject.description).toContain('**updated**');

    expect((await api('projects', 'archive', pid)).is_archived).toBe(true);
    expect((await api('projects', 'unarchive', pid)).is_archived).toBe(false);
  });

  it('an API error surfaces as exit 1 with a problem+json body', async () => {
    // Proves Vikunja errors are problem+json, which the Cloudflare-rejection detection depends on.
    const { code, stderr } = await apiFail('tasks', 'get', '2147480000');
    expect(code).toBe(1);
    const parsed = JSON.parse(stderr);
    expect([403, 404]).toContain(parsed.error.status);
  });
});
