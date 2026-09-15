import { describe, expect, it } from 'vitest';
import { CliError, errorJson, usageError } from '../src/errors';

describe('CliError', () => {
  it('carries exit code and error info', () => {
    const err = new CliError(3, 'profile `x` not found', { detail: 'run vikunja profile list' });
    expect(err.exitCode).toBe(3);
    expect(err.message).toBe('profile `x` not found');
    expect(err.info).toEqual({ title: 'profile `x` not found', detail: 'run vikunja profile list' });
  });

  it('usageError uses exit code 2', () => {
    expect(usageError('bad', 'why')).toMatchObject({ exitCode: 2, info: { title: 'bad', detail: 'why' } });
  });
});

describe('errorJson', () => {
  it('serializes a CliError', () => {
    const out = errorJson(new CliError(1, 'Not Found', { status: 404, detail: 'task 9' }));
    expect(out.exitCode).toBe(1);
    expect(JSON.parse(out.json)).toEqual({ error: { title: 'Not Found', status: 404, detail: 'task 9' } });
  });

  it('maps unknown errors to exit 1', () => {
    expect(errorJson(new Error('boom'))).toEqual({ exitCode: 1, json: '{"error":{"title":"boom"}}' });
  });
});
