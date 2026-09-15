import { describe, expect, it } from 'vitest';
import { securityKeychain, type RunResult, type SecurityRunner } from '../src/keychain';

function runner(result: Partial<RunResult>) {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const run: SecurityRunner = async (args, stdin) => {
    calls.push({ args, stdin });
    return { code: 0, stdout: '', stderr: '', ...result };
  };
  return { run, calls };
}

describe('securityKeychain', () => {
  it('get reads the password with find-generic-password -w', async () => {
    const { run, calls } = runner({ stdout: 'tk_abc\n' });
    expect(await securityKeychain('svc', run).get('profile:me')).toBe('tk_abc');
    expect(calls[0].args).toEqual(['find-generic-password', '-s', 'svc', '-a', 'profile:me', '-w']);
  });

  it('get returns null when the item does not exist (exit 44)', async () => {
    const { run } = runner({ code: 44 });
    expect(await securityKeychain('svc', run).get('profile:me')).toBeNull();
  });

  it('get throws exit 3 on other failures', async () => {
    const { run } = runner({ code: 1, stderr: 'boom\n' });
    await expect(securityKeychain('svc', run).get('x')).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'Keychain read failed', detail: 'boom' },
    });
  });

  it('set sends the command on stdin, not in argv', async () => {
    const { run, calls } = runner({});
    await securityKeychain('svc', run).set('cf:client-secret', 's3cr3t');
    expect(calls[0].args).toEqual(['-i']);
    expect(calls[0].stdin).toBe('add-generic-password -U -s svc -a cf:client-secret -w s3cr3t\n');
  });

  it('set ignores the interactive prompt echoed by security -i', async () => {
    const { run } = runner({ stderr: 'security> ' });
    await expect(securityKeychain('svc', run).set('a', 'b')).resolves.toBeUndefined();
  });

  it('set rejects unsafe characters without calling security', async () => {
    const { run, calls } = runner({});
    await expect(securityKeychain('svc', run).set('a', 'has space')).rejects.toMatchObject({ exitCode: 2 });
    expect(calls).toHaveLength(0);
  });

  it('set throws exit 3 when security reports an error', async () => {
    const { run } = runner({ stderr: 'security: SecKeychainItemCreateFromContent: failed\n' });
    await expect(securityKeychain('svc', run).set('a', 'b')).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'Keychain write failed' },
    });
  });

  it('delete succeeds when the item is missing', async () => {
    const { run, calls } = runner({ code: 44 });
    await expect(securityKeychain('svc', run).delete('profile:me')).resolves.toBeUndefined();
    expect(calls[0].args).toEqual(['delete-generic-password', '-s', 'svc', '-a', 'profile:me']);
  });
});
