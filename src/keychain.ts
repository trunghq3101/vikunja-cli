import { spawn } from 'node:child_process';
import { CliError } from './errors';

export interface Keychain {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SecurityRunner = (args: string[], stdin?: string) => Promise<RunResult>;

export const KEYCHAIN_SERVICE = 'vikunja-cli';

const ITEM_NOT_FOUND = 44;
const SAFE_VALUE = /^[A-Za-z0-9._~+/=:-]+$/;

export const runSecurity: SecurityRunner = (args, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });

export function securityKeychain(service = KEYCHAIN_SERVICE, run: SecurityRunner = runSecurity): Keychain {
  return {
    async get(account) {
      const result = await run(['find-generic-password', '-s', service, '-a', account, '-w']);
      if (result.code === ITEM_NOT_FOUND) return null;
      if (result.code !== 0) {
        throw new CliError(3, 'Keychain read failed', { detail: result.stderr.trim() });
      }
      return result.stdout.replace(/\n$/, '');
    },

    async set(account, secret) {
      if (!SAFE_VALUE.test(account) || !SAFE_VALUE.test(secret)) {
        throw new CliError(2, 'value contains unsupported characters', {
          detail: 'allowed: letters, digits and . _ ~ + / = : -',
        });
      }
      const result = await run(['-i'], `add-generic-password -U -s ${service} -a ${account} -w ${secret}\n`);
      const errText = result.stderr.replace(/security>\s*/g, '').trim();
      if (result.code !== 0 || errText !== '') {
        throw new CliError(3, 'Keychain write failed', { detail: errText });
      }
    },

    async delete(account) {
      const result = await run(['delete-generic-password', '-s', service, '-a', account]);
      if (result.code !== 0 && result.code !== ITEM_NOT_FOUND) {
        throw new CliError(3, 'Keychain delete failed', { detail: result.stderr.trim() });
      }
    },
  };
}
