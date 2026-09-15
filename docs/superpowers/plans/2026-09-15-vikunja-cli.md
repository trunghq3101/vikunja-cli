# vikunja CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `vikunja`, a JSON-speaking CLI for AI agents that manages projects, tasks, labels and comments on a self-hosted Vikunja (API v2) behind Cloudflare Access, with per-agent bot profiles stored in the macOS Keychain, shipped as a Claude Code plugin.

**Architecture:** TypeScript sources in `src/` are bundled by esbuild into one committed CommonJS file, `plugin/bin/vikunja`, which Claude Code puts on the Bash PATH. `client.ts` owns all HTTP concerns (Cloudflare headers, auth, errors, pagination), `config.ts` owns settings and identity resolution, `keychain.ts` wraps `/usr/bin/security`, and each `commands/*.ts` file maps arguments to client calls. A plugin skill teaches agents the commands and pre-approves them.

**Tech Stack:** Node ≥ 20 (runtime), TypeScript 5.9.3, commander 14.0.3 (bundled), esbuild 0.28.2, vitest 5.0.0 (needs Node ≥ 22.12 for development), `@types/node` 22.20.2.

**Spec:** `docs/superpowers/specs/2026-09-15-vikunja-cli-design.md`. Read it before starting any task.

## Global Constraints

- Runtime Node ≥ 20; the bundle targets `node20`. The only runtime dependency is `commander@14.0.3`, bundled into `plugin/bin/vikunja`.
- API calls go to `<url>/api/v2` only.
- Success prints exactly one JSON document plus `\n` to stdout. Errors print exactly one JSON document `{"error":{"title",...}}` plus `\n` to stderr and nothing to stdout.
- Exit codes: `0` success, `1` API/network error, `2` usage error, `3` config/auth error.
- Keychain service `vikunja-cli`; accounts `cf:client-id`, `cf:client-secret`, `profile:<name>`.
- Config file `${XDG_CONFIG_HOME:-~/.config}/vikunja-cli/config.json`, mode 600. (`XDG_CONFIG_HOME` exists so tests can use a temp dir.)
- Env vars: `VIKUNJA_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `VIKUNJA_API_TOKEN`, `VIKUNJA_PROFILE`, `VIKUNJA_PROFILE_LOCK`.
- Profile names match `^[a-z0-9][a-z0-9_-]{0,31}$`.
- No command ever prints a token or the Cloudflare secret.
- Request timeout 30 s; no retries; `--per-page` default 50, max 1000; `--all` caps at 5,000 items.
- `PATCH` bodies use `Content-Type: application/merge-patch+json`; `X-Vikunja-Format: markdown` is sent only when the PATCH body has `description`; every PATCH is followed by `GET …?format=markdown` whose result is printed.
- Version `0.1.0` must be identical in `package.json`, `plugin/.claude-plugin/plugin.json` and `VERSION` in `src/cli.ts`.
- Every commit message ends with a blank line and exactly these two trailer lines:

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
  ```

## File Map

| File | Responsibility | Task |
|---|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Tooling | 1 |
| `src/errors.ts` | `CliError`, `usageError`, `errorJson` | 1 |
| `src/keychain.ts` | `Keychain` interface, `securityKeychain()` | 2 |
| `test/fakes.ts` | `memoryKeychain`, `fakeFetch`, `jsonResponse` | 2, 4 |
| `src/config.ts` | Config file I/O, `resolveConnection`, `resolveIdentity` | 3 |
| `src/client.ts` | `VikunjaClient`: request, error mapping, pagination | 4 |
| `src/output.ts` | Date normalization, trimming, list shaping | 5 |
| `src/dates.ts` | `--due` parsing | 5 |
| `src/context.ts` | `Deps`, `apiContext`, `print` | 6 |
| `src/commands/common.ts` | Shared option helpers, parsers, `listAndShape`, `patchAndReread` | 6 |
| `src/cli.ts` | `buildProgram`, `runCli`, `VERSION` | 6 |
| `test/harness.ts` | CLI test harness | 6 |
| `src/commands/whoami.ts`, `projects.ts` | whoami + projects | 6 |
| `src/commands/tasks.ts` | tasks | 7 |
| `src/commands/labels.ts`, `comments.ts` | labels + comments | 8 |
| `src/prompt.ts`, `src/commands/setup.ts`, `profile.ts`, `src/main.ts` | Human-run setup, entry point | 9 |
| `scripts/build.mjs`, `plugin/package.json`, `plugin/bin/vikunja` | Bundle | 10 |
| `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `plugin/skills/vikunja/SKILL.md`, `README.md` | Packaging | 11 |
| `vitest.smoke.config.ts`, `smoke/smoke.test.ts` | Live smoke test | 12 |

---

### Task 1: Project scaffold and error type

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/errors.ts`
- Test: `test/errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ExitCode = 1 | 2 | 3`
  - `interface ErrorInfo { status?: number; title: string; detail?: string; errors?: unknown[] }`
  - `class CliError extends Error { readonly exitCode: ExitCode; readonly info: ErrorInfo; constructor(exitCode: ExitCode, title: string, extra?: Omit<ErrorInfo, 'title'>) }`
  - `function usageError(title: string, detail?: string): CliError` (exit code 2)
  - `function errorJson(err: unknown): { exitCode: ExitCode; json: string }`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "vikunja-cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "smoke": "vitest run --config vitest.smoke.config.ts"
  }
}
```

- [ ] **Step 2: Install dependencies with exact versions**

Run:
```bash
npm install --save-exact commander@14.0.3
npm install --save-exact --save-dev typescript@5.9.3 vitest@5.0.0 esbuild@0.28.2 @types/node@22.20.2
```
Expected: `package.json` now has `dependencies.commander` and the four `devDependencies`; `package-lock.json` is created.

- [ ] **Step 3: Create `tsconfig.json`, `vitest.config.ts`, `.gitignore`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "checkJs": false,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test", "smoke", "scripts", "*.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] },
});
```

`.gitignore`:
```
node_modules/
```

- [ ] **Step 4: Write the failing test `test/errors.test.ts`**

```ts
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
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run test/errors.test.ts`
Expected: FAIL, cannot resolve `../src/errors`.

- [ ] **Step 6: Implement `src/errors.ts`**

```ts
export type ExitCode = 1 | 2 | 3;

export interface ErrorInfo {
  status?: number;
  title: string;
  detail?: string;
  errors?: unknown[];
}

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly info: ErrorInfo;

  constructor(exitCode: ExitCode, title: string, extra: Omit<ErrorInfo, 'title'> = {}) {
    super(title);
    this.exitCode = exitCode;
    this.info = { title, ...extra };
  }
}

export function usageError(title: string, detail?: string): CliError {
  return new CliError(2, title, { detail });
}

export function errorJson(err: unknown): { exitCode: ExitCode; json: string } {
  if (err instanceof CliError) {
    return { exitCode: err.exitCode, json: JSON.stringify({ error: err.info }) };
  }
  const title = err instanceof Error ? err.message : String(err);
  return { exitCode: 1, json: JSON.stringify({ error: { title } }) };
}
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run test/errors.test.ts && npm run typecheck`
Expected: 4 tests PASS; `tsc` prints nothing and exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/errors.ts test/errors.test.ts
git commit -F- <<'EOF'
chore: scaffold project and add CliError

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 2: Keychain wrapper

**Files:**
- Create: `src/keychain.ts`
- Create: `test/fakes.ts`
- Test: `test/keychain.test.ts`, `test/keychain.darwin.test.ts`

**Interfaces:**
- Consumes: `CliError` from `src/errors.ts`.
- Produces:
  - `interface Keychain { get(account: string): Promise<string | null>; set(account: string, secret: string): Promise<void>; delete(account: string): Promise<void> }`
  - `interface RunResult { code: number; stdout: string; stderr: string }`
  - `type SecurityRunner = (args: string[], stdin?: string) => Promise<RunResult>`
  - `const KEYCHAIN_SERVICE = 'vikunja-cli'`
  - `function securityKeychain(service?: string, run?: SecurityRunner): Keychain`
  - `test/fakes.ts`: `function memoryKeychain(initial?: Record<string, string>): Keychain & { items: Map<string, string> }`

Background: `security find-generic-password -w` prints the secret and exits 44 when the item does not exist. `security -i` reads commands from stdin; we use it for writes so the secret never appears in process arguments (visible via `ps`). Values are restricted to a safe character set, so no quoting is needed on the stdin line. Real tokens (`tk_` + hex) and Cloudflare credentials (hex, `.access` suffix) fit that set.

- [ ] **Step 1: Write the failing unit test `test/keychain.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/keychain.test.ts`
Expected: FAIL, cannot resolve `../src/keychain`.

- [ ] **Step 3: Implement `src/keychain.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/keychain.test.ts`
Expected: 8 tests PASS.

- [ ] **Step 5: Add the real-Keychain test `test/keychain.darwin.test.ts`**

It is skipped unless `KEYCHAIN_IT=1`, and uses a separate service name so it never touches real `vikunja-cli` items.

```ts
import { describe, expect, it } from 'vitest';
import { securityKeychain } from '../src/keychain';

describe.runIf(process.platform === 'darwin' && process.env.KEYCHAIN_IT === '1')('real macOS keychain', () => {
  it('round-trips, updates and deletes a secret', async () => {
    const kc = securityKeychain('vikunja-cli-test');
    await kc.delete('it:account');
    expect(await kc.get('it:account')).toBeNull();
    await kc.set('it:account', 'tk_0123abcd');
    expect(await kc.get('it:account')).toBe('tk_0123abcd');
    await kc.set('it:account', 'tk_updated');
    expect(await kc.get('it:account')).toBe('tk_updated');
    await kc.delete('it:account');
    expect(await kc.get('it:account')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it against the real Keychain**

Run: `KEYCHAIN_IT=1 npx vitest run test/keychain.darwin.test.ts`
Expected: 1 test PASS, with no macOS password dialog.
If `set` fails with "Keychain write failed", print the raw `stderr` from `runSecurity(['-i'], ...)` and adjust only the prompt-filtering regex in `set` to strip what `security -i` echoes. Re-run until it passes. If a dialog appears, stop and report it; do not work around it.

- [ ] **Step 7: Create `test/fakes.ts`**

```ts
import type { Keychain } from '../src/keychain';

export function memoryKeychain(initial: Record<string, string> = {}): Keychain & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    async get(account) {
      return items.get(account) ?? null;
    },
    async set(account, secret) {
      items.set(account, secret);
    },
    async delete(account) {
      items.delete(account);
    },
  };
}
```

- [ ] **Step 8: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS (the darwin test shows as skipped); typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
git add src/keychain.ts test/keychain.test.ts test/keychain.darwin.test.ts test/fakes.ts
git commit -F- <<'EOF'
feat: add macOS Keychain wrapper

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 3: Config file and identity resolution

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `CliError` (`src/errors.ts`), `Keychain` (`src/keychain.ts`), `memoryKeychain` (`test/fakes.ts`).
- Produces:
  - `type Env = Record<string, string | undefined>`
  - `interface ConfigFile { url?: string; default_profile?: string; profiles: Record<string, { username: string }> }`
  - `interface Connection { url: string; cfClientId: string; cfClientSecret: string }`
  - `interface Identity { profile: string; token: string }`
  - `const ACCOUNT_CF_ID = 'cf:client-id'`, `const ACCOUNT_CF_SECRET = 'cf:client-secret'`, `function profileAccount(name: string): string` (returns `profile:<name>`)
  - `const PROFILE_NAME: RegExp`
  - `function configPath(env: Env): string`
  - `function loadConfig(env: Env): Promise<ConfigFile>`
  - `function saveConfig(env: Env, cfg: ConfigFile): Promise<void>`
  - `function normalizeUrl(url: string): string`
  - `function resolveConnection(env: Env, keychain: Keychain, cfg: ConfigFile): Promise<Connection>`
  - `function resolveIdentity(as: string | undefined, env: Env, keychain: Keychain, cfg: ConfigFile): Promise<Identity>`

- [ ] **Step 1: Write the failing test `test/config.test.ts`**

```ts
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  configPath,
  loadConfig,
  resolveConnection,
  resolveIdentity,
  saveConfig,
  type ConfigFile,
  type Env,
} from '../src/config';
import { memoryKeychain } from './fakes';

let env: Env;

beforeEach(async () => {
  env = { XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), 'vikunja-cli-')) };
});

describe('config file', () => {
  it('lives under XDG_CONFIG_HOME', () => {
    expect(configPath(env)).toBe(join(env.XDG_CONFIG_HOME!, 'vikunja-cli', 'config.json'));
  });

  it('is empty when missing', async () => {
    expect(await loadConfig(env)).toEqual({ profiles: {} });
  });

  it('saves with mode 600 and loads back', async () => {
    const cfg: ConfigFile = { url: 'https://vk.test', default_profile: 'me', profiles: { me: { username: 'trung' } } };
    await saveConfig(env, cfg);
    expect(await loadConfig(env)).toEqual(cfg);
    expect((await stat(configPath(env))).mode & 0o777).toBe(0o600);
  });

  it('throws exit 3 on invalid JSON', async () => {
    await mkdir(join(env.XDG_CONFIG_HOME!, 'vikunja-cli'), { recursive: true });
    await writeFile(configPath(env), '{nope');
    await expect(loadConfig(env)).rejects.toMatchObject({ exitCode: 3, info: { title: 'cannot read config file' } });
  });
});

describe('resolveConnection', () => {
  const stored = () => memoryKeychain({ 'cf:client-id': 'kc-id', 'cf:client-secret': 'kc-secret' });

  it('reads stored values and strips trailing slashes', async () => {
    expect(await resolveConnection(env, stored(), { url: 'https://vk.test//', profiles: {} })).toEqual({
      url: 'https://vk.test',
      cfClientId: 'kc-id',
      cfClientSecret: 'kc-secret',
    });
  });

  it('prefers env vars', async () => {
    const e = { ...env, VIKUNJA_URL: 'https://env.test', CF_ACCESS_CLIENT_ID: 'env-id', CF_ACCESS_CLIENT_SECRET: 'env-secret' };
    expect(await resolveConnection(e, stored(), { url: 'https://vk.test', profiles: {} })).toEqual({
      url: 'https://env.test',
      cfClientId: 'env-id',
      cfClientSecret: 'env-secret',
    });
  });

  it.each([
    ['url', { profiles: {} }, { 'cf:client-id': 'i', 'cf:client-secret': 's' }, 'Vikunja URL is not configured'],
    ['cf id', { url: 'https://vk.test', profiles: {} }, { 'cf:client-secret': 's' }, 'Cloudflare Access client ID is not configured'],
    ['cf secret', { url: 'https://vk.test', profiles: {} }, { 'cf:client-id': 'i' }, 'Cloudflare Access client secret is not configured'],
  ])('exit 3 when %s is missing', async (_name, cfg, items, title) => {
    await expect(resolveConnection(env, memoryKeychain(items), cfg as ConfigFile)).rejects.toMatchObject({
      exitCode: 3,
      info: { title },
    });
  });
});

describe('resolveIdentity', () => {
  const keychain = memoryKeychain({ 'profile:me': 'tk_me', 'profile:reviewer': 'tk_rev', 'profile:planner': 'tk_plan' });
  const cfg: ConfigFile = { default_profile: 'me', profiles: {} };

  it('--as wins over everything', async () => {
    const e = { ...env, VIKUNJA_PROFILE: 'planner', VIKUNJA_API_TOKEN: 'tk_env' };
    expect(await resolveIdentity('reviewer', e, keychain, cfg)).toEqual({ profile: 'reviewer', token: 'tk_rev' });
  });

  it('VIKUNJA_PROFILE beats VIKUNJA_API_TOKEN and the default', async () => {
    const e = { ...env, VIKUNJA_PROFILE: 'planner', VIKUNJA_API_TOKEN: 'tk_env' };
    expect(await resolveIdentity(undefined, e, keychain, cfg)).toEqual({ profile: 'planner', token: 'tk_plan' });
  });

  it('VIKUNJA_API_TOKEN beats the default profile', async () => {
    const e = { ...env, VIKUNJA_API_TOKEN: 'tk_env' };
    expect(await resolveIdentity(undefined, e, keychain, cfg)).toEqual({ profile: '(env)', token: 'tk_env' });
  });

  it('falls back to the default profile', async () => {
    expect(await resolveIdentity(undefined, env, keychain, cfg)).toEqual({ profile: 'me', token: 'tk_me' });
  });

  it('rejects --as when the session is locked', async () => {
    const e = { ...env, VIKUNJA_PROFILE_LOCK: '1', VIKUNJA_PROFILE: 'planner' };
    await expect(resolveIdentity('reviewer', e, keychain, cfg)).rejects.toMatchObject({
      exitCode: 2,
      info: { title: 'profile is locked for this session' },
    });
  });

  it('a locked session still uses VIKUNJA_PROFILE', async () => {
    const e = { ...env, VIKUNJA_PROFILE_LOCK: '1', VIKUNJA_PROFILE: 'planner' };
    expect(await resolveIdentity(undefined, e, keychain, cfg)).toEqual({ profile: 'planner', token: 'tk_plan' });
  });

  it('unknown or invalid profile names are exit 3', async () => {
    await expect(resolveIdentity('ghost', env, keychain, cfg)).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'profile `ghost` not found' },
    });
    await expect(resolveIdentity('../x', env, keychain, cfg)).rejects.toMatchObject({ exitCode: 3 });
  });

  it('no profile at all is exit 3', async () => {
    await expect(resolveIdentity(undefined, env, keychain, { profiles: {} })).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'no profile configured' },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, cannot resolve `../src/config`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError } from './errors';
import type { Keychain } from './keychain';

export type Env = Record<string, string | undefined>;

export interface ConfigFile {
  url?: string;
  default_profile?: string;
  profiles: Record<string, { username: string }>;
}

export interface Connection {
  url: string;
  cfClientId: string;
  cfClientSecret: string;
}

export interface Identity {
  profile: string;
  token: string;
}

export const ACCOUNT_CF_ID = 'cf:client-id';
export const ACCOUNT_CF_SECRET = 'cf:client-secret';
export const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function profileAccount(name: string): string {
  return `profile:${name}`;
}

export function configPath(env: Env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'vikunja-cli', 'config.json');
}

export async function loadConfig(env: Env): Promise<ConfigFile> {
  const path = configPath(env);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<ConfigFile>;
    return { ...parsed, profiles: parsed.profiles ?? {} };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: {} };
    throw new CliError(3, 'cannot read config file', { detail: `${path}: ${(err as Error).message}` });
  }
}

export async function saveConfig(env: Env, cfg: ConfigFile): Promise<void> {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function notConfigured(what: string, envVar: string): CliError {
  return new CliError(3, `${what} is not configured`, { detail: `set ${envVar} or run \`vikunja setup\`` });
}

export async function resolveConnection(env: Env, keychain: Keychain, cfg: ConfigFile): Promise<Connection> {
  const url = env.VIKUNJA_URL || cfg.url;
  if (!url) throw notConfigured('Vikunja URL', 'VIKUNJA_URL');
  const cfClientId = env.CF_ACCESS_CLIENT_ID || (await keychain.get(ACCOUNT_CF_ID));
  if (!cfClientId) throw notConfigured('Cloudflare Access client ID', 'CF_ACCESS_CLIENT_ID');
  const cfClientSecret = env.CF_ACCESS_CLIENT_SECRET || (await keychain.get(ACCOUNT_CF_SECRET));
  if (!cfClientSecret) throw notConfigured('Cloudflare Access client secret', 'CF_ACCESS_CLIENT_SECRET');
  return { url: normalizeUrl(url), cfClientId, cfClientSecret };
}

async function fromProfile(name: string, keychain: Keychain): Promise<Identity> {
  const token = PROFILE_NAME.test(name) ? await keychain.get(profileAccount(name)) : null;
  if (!token) {
    throw new CliError(3, `profile \`${name}\` not found`, { detail: 'run `vikunja profile list` to see configured profiles' });
  }
  return { profile: name, token };
}

export async function resolveIdentity(
  as: string | undefined,
  env: Env,
  keychain: Keychain,
  cfg: ConfigFile,
): Promise<Identity> {
  if (as !== undefined) {
    if (env.VIKUNJA_PROFILE_LOCK === '1') {
      throw new CliError(2, 'profile is locked for this session', {
        detail: 'VIKUNJA_PROFILE_LOCK=1 is set, so --as is not allowed',
      });
    }
    return fromProfile(as, keychain);
  }
  if (env.VIKUNJA_PROFILE) return fromProfile(env.VIKUNJA_PROFILE, keychain);
  if (env.VIKUNJA_API_TOKEN) return { profile: '(env)', token: env.VIKUNJA_API_TOKEN };
  if (cfg.default_profile) return fromProfile(cfg.default_profile, keychain);
  throw new CliError(3, 'no profile configured', { detail: 'run `vikunja profile add <name>`' });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run test/config.test.ts && npm run typecheck`
Expected: 16 tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -F- <<'EOF'
feat: add config file and profile resolution

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 4: HTTP client

**Files:**
- Create: `src/client.ts`
- Modify: `test/fakes.ts` (append `fakeFetch`, `jsonResponse`)
- Test: `test/client.test.ts`

**Interfaces:**
- Consumes: `CliError` (`src/errors.ts`), `Connection` (`src/config.ts`).
- Produces:
  - `type FetchFn = (url: string, init: RequestInit) => Promise<Response>`
  - `type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'`
  - `type QueryValue = string | number | boolean | undefined | Array<string | number>`; `type Query = Record<string, QueryValue>`
  - `interface RequestOptions { query?: Query; body?: unknown; headers?: Record<string, string> }`
  - `interface Page<T> { items: T[]; page: number; per_page: number; total_pages: number; total: number }`
  - `interface AllItems<T> { items: T[]; total: number; truncated?: true }`
  - `const ALL_ITEMS_CAP = 5000`
  - `interface ClientOptions { connection: Connection; token?: string; profile?: string; fetch?: FetchFn; timeoutMs?: number }`
  - `function buildUrl(base: string, path: string, query?: Query): string`
  - `class VikunjaClient { constructor(opts: ClientOptions); request<T>(method: Method, path: string, options?: RequestOptions): Promise<T>; listPage<T>(path: string, query: Query): Promise<Page<T>>; listAll<T>(path: string, query: Query, cap?: number): Promise<AllItems<T>> }`
  - `test/fakes.ts`: `interface FetchCall { method: string; url: string; headers: Record<string, string>; body: unknown; init: RequestInit }`, `function fakeFetch(...responses: Array<Response | Error>): { fn: FetchFn; calls: FetchCall[]; queue(...more: Array<Response | Error>): void }`, `function jsonResponse(status: number, data?: unknown, contentType?: string): Response`

Paths passed to `request` start with `/` and exclude `/api/v2` (e.g. `/tasks/5`).

- [ ] **Step 1: Append the fetch fakes to `test/fakes.ts`**

Add this import at the top of the file:
```ts
import type { FetchFn } from '../src/client';
```
Append at the end of the file:
```ts
export interface FetchCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

export function fakeFetch(...responses: Array<Response | Error>) {
  const calls: FetchCall[] = [];
  const pending = [...responses];
  const fn: FetchFn = async (url, init) => {
    calls.push({
      method: String(init.method),
      url,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      init,
    });
    const next = pending.shift();
    if (next === undefined) throw new Error(`unexpected request: ${init.method} ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { fn, calls, queue: (...more: Array<Response | Error>) => void pending.push(...more) };
}

export function jsonResponse(status: number, data?: unknown, contentType = 'application/json'): Response {
  const body = status === 204 || data === undefined ? null : JSON.stringify(data);
  return new Response(body, { status, headers: { 'content-type': contentType } });
}
```

- [ ] **Step 2: Write the failing test `test/client.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildUrl, VikunjaClient, type FetchFn } from '../src/client';
import { fakeFetch, jsonResponse } from './fakes';

const connection = { url: 'https://vk.test', cfClientId: 'cf-id', cfClientSecret: 'cf-secret' };
const makeClient = (fetch: FetchFn, timeoutMs?: number) =>
  new VikunjaClient({ connection, token: 'tk_me', profile: 'me', fetch, timeoutMs });

const CF_TITLE = 'Cloudflare Access rejected the request — check the service token (vikunja setup)';

describe('buildUrl', () => {
  it('prefixes /api/v2, repeats arrays and skips undefined', () => {
    expect(
      buildUrl('https://vk.test', '/tasks', {
        q: 'a b',
        filter: undefined,
        sort_by: ['due_date', 'id'],
        order_by: ['asc', 'desc'],
        page: 2,
      }),
    ).toBe('https://vk.test/api/v2/tasks?q=a+b&sort_by=due_date&sort_by=id&order_by=asc&order_by=desc&page=2');
  });

  it('has no question mark without query', () => {
    expect(buildUrl('https://vk.test', '/user')).toBe('https://vk.test/api/v2/user');
  });
});

describe('VikunjaClient.request', () => {
  it('sends Cloudflare and bearer headers, manual redirects, and parses JSON', async () => {
    const f = fakeFetch(jsonResponse(200, { id: 1 }));
    expect(await makeClient(f.fn).request('GET', '/user')).toEqual({ id: 1 });
    expect(f.calls[0]).toMatchObject({
      method: 'GET',
      url: 'https://vk.test/api/v2/user',
      headers: { 'CF-Access-Client-Id': 'cf-id', 'CF-Access-Client-Secret': 'cf-secret', Authorization: 'Bearer tk_me' },
    });
    expect(f.calls[0].init.redirect).toBe('manual');
  });

  it('omits Authorization without a token', async () => {
    const f = fakeFetch(jsonResponse(200, { version: 'v2.6.0' }));
    await new VikunjaClient({ connection, fetch: f.fn }).request('GET', '/info');
    expect(f.calls[0].headers.Authorization).toBeUndefined();
  });

  it('uses application/json for POST and merge-patch+json for PATCH', async () => {
    const f = fakeFetch(jsonResponse(201, { id: 2 }), jsonResponse(200, { id: 2 }));
    const client = makeClient(f.fn);
    await client.request('POST', '/labels', { body: { title: 'x' } });
    await client.request('PATCH', '/tasks/2', { body: { done: true }, headers: { 'X-Vikunja-Format': 'markdown' } });
    expect(f.calls[0].headers['Content-Type']).toBe('application/json');
    expect(f.calls[0].body).toEqual({ title: 'x' });
    expect(f.calls[1].headers['Content-Type']).toBe('application/merge-patch+json');
    expect(f.calls[1].headers['X-Vikunja-Format']).toBe('markdown');
  });

  it('returns undefined for 204', async () => {
    const f = fakeFetch(jsonResponse(204));
    expect(await makeClient(f.fn).request('DELETE', '/tasks/1')).toBeUndefined();
  });

  it.each([
    ['a redirect to cloudflareaccess.com', new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login' } })],
    ['an HTML page', new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })],
    ['a 403 without problem+json', new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })],
  ])('maps %s to exit 3', async (_name, response) => {
    await expect(makeClient(fakeFetch(response).fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 3,
      info: { title: CF_TITLE },
    });
  });

  it('maps 401 to exit 3 naming the profile', async () => {
    const f = fakeFetch(jsonResponse(401, { title: 'Unauthorized', status: 401 }, 'application/problem+json'));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 3,
      info: { title: 'Vikunja token for profile `me` is invalid or expired', status: 401 },
    });
  });

  it('maps problem+json errors to exit 1 with details', async () => {
    const problem = {
      title: 'Unprocessable Entity',
      status: 422,
      detail: 'validation failed',
      errors: [{ location: 'body.title', message: 'required' }],
    };
    const f = fakeFetch(jsonResponse(422, problem, 'application/problem+json'));
    const err = await makeClient(f.fn).request('POST', '/labels', { body: {} }).catch((e) => e);
    expect(err.exitCode).toBe(1);
    expect(err.info).toEqual(problem);
  });

  it('treats a Vikunja 403 problem+json as an API error', async () => {
    const f = fakeFetch(jsonResponse(403, { title: 'Forbidden', status: 403 }, 'application/problem+json'));
    await expect(makeClient(f.fn).request('GET', '/projects/1')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'Forbidden', status: 403 },
    });
  });

  it('uses HTTP <status> when the error body is not JSON', async () => {
    const f = fakeFetch(new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } }));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'HTTP 502', status: 502, detail: 'bad gateway' },
    });
  });

  it('maps network failures to exit 1', async () => {
    const f = fakeFetch(new TypeError('fetch failed'));
    await expect(makeClient(f.fn).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'network error' },
    });
  });

  it('maps timeouts to exit 1', async () => {
    const f = fakeFetch(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    await expect(makeClient(f.fn, 5000).request('GET', '/user')).rejects.toMatchObject({
      exitCode: 1,
      info: { title: 'request timed out after 5s' },
    });
  });
});

describe('pagination', () => {
  const page = (items: number[], pageNo: number, totalPages: number, total: number) =>
    jsonResponse(200, { items: items.map((id) => ({ id })), page: pageNo, per_page: 2, total_pages: totalPages, total });

  it('listPage passes the query through', async () => {
    const f = fakeFetch(page([1, 2], 1, 1, 2));
    const res = await makeClient(f.fn).listPage('/labels', { page: 1, per_page: 2 });
    expect(res.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(f.calls[0].url).toBe('https://vk.test/api/v2/labels?page=1&per_page=2');
  });

  it('listAll follows total_pages', async () => {
    const f = fakeFetch(page([1, 2], 1, 2, 3), page([3], 2, 2, 3));
    expect(await makeClient(f.fn).listAll('/labels', { per_page: 2 })).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 3,
    });
    expect(new URL(f.calls[1].url).searchParams.get('page')).toBe('2');
  });

  it('listAll stops at the cap and marks the result truncated', async () => {
    const f = fakeFetch(page([1, 2], 1, 3, 6), page([3, 4], 2, 3, 6));
    expect(await makeClient(f.fn).listAll('/labels', { per_page: 2 }, 3)).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      total: 6,
      truncated: true,
    });
    expect(f.calls).toHaveLength(2);
  });

  it('listAll treats null items as empty', async () => {
    const f = fakeFetch(jsonResponse(200, { items: null, page: 1, per_page: 50, total_pages: 0, total: 0 }));
    expect(await makeClient(f.fn).listAll('/labels', {})).toEqual({ items: [], total: 0 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/client.test.ts`
Expected: FAIL, cannot resolve `../src/client`.

- [ ] **Step 4: Implement `src/client.ts`**

```ts
import type { Connection } from './config';
import { CliError } from './errors';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface Page<T> {
  items: T[];
  page: number;
  per_page: number;
  total_pages: number;
  total: number;
}

export interface AllItems<T> {
  items: T[];
  total: number;
  truncated?: true;
}

export interface ClientOptions {
  connection: Connection;
  token?: string;
  profile?: string;
  fetch?: FetchFn;
  timeoutMs?: number;
}

export const ALL_ITEMS_CAP = 5000;

const CLOUDFLARE_REJECTED = 'Cloudflare Access rejected the request — check the service token (vikunja setup)';

export function buildUrl(base: string, path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item));
  }
  const qs = params.toString();
  return `${base}/api/v2${path}${qs ? `?${qs}` : ''}`;
}

function isCloudflareRejection(res: Response): boolean {
  const location = res.headers.get('location');
  if (res.status >= 300 && res.status < 400 && location) {
    try {
      if (new URL(location, 'https://placeholder.invalid').hostname.endsWith('cloudflareaccess.com')) return true;
    } catch {
      // unparseable Location header: fall through to the generic checks
    }
  }
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html')) return true;
  return res.status === 403 && !type.includes('application/problem+json');
}

async function apiError(res: Response): Promise<CliError> {
  const text = await res.text();
  try {
    const problem = JSON.parse(text) as { title?: string; detail?: string; errors?: unknown[] | null };
    return new CliError(1, problem.title ?? `HTTP ${res.status}`, {
      status: res.status,
      detail: problem.detail,
      errors: problem.errors ?? undefined,
    });
  } catch {
    return new CliError(1, `HTTP ${res.status}`, { status: res.status, detail: text.slice(0, 500) });
  }
}

export class VikunjaClient {
  constructor(private readonly opts: ClientOptions) {}

  async request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
    const { connection, token, profile, fetch: fetchFn = fetch, timeoutMs = 30_000 } = this.opts;
    const url = buildUrl(connection.url, path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      'CF-Access-Client-Id': connection.cfClientId,
      'CF-Access-Client-Secret': connection.cfClientSecret,
      ...options.headers,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = method === 'PATCH' ? 'application/merge-patch+json' : 'application/json';
      body = JSON.stringify(options.body);
    }

    let res: Response;
    try {
      res = await fetchFn(url, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const e = err as Error;
      const title = e.name === 'TimeoutError' ? `request timed out after ${timeoutMs / 1000}s` : 'network error';
      throw new CliError(1, title, { detail: `${method} ${url}: ${e.message}` });
    }

    if (isCloudflareRejection(res)) throw new CliError(3, CLOUDFLARE_REJECTED, { status: res.status });
    if (res.status === 401) {
      throw new CliError(3, `Vikunja token for profile \`${profile ?? '(none)'}\` is invalid or expired`, { status: 401 });
    }
    if (!res.ok) throw await apiError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  listPage<T>(path: string, query: Query): Promise<Page<T>> {
    return this.request<Page<T>>('GET', path, { query });
  }

  async listAll<T>(path: string, query: Query, cap = ALL_ITEMS_CAP): Promise<AllItems<T>> {
    const perPage = Number(query.per_page ?? 50);
    const items: T[] = [];
    let page = 1;
    let total = 0;
    let totalPages = 1;
    do {
      const res = await this.listPage<T>(path, { ...query, page, per_page: perPage });
      items.push(...(res.items ?? []));
      total = res.total;
      totalPages = res.total_pages;
      page += 1;
    } while (page <= totalPages && items.length < cap);
    if (items.length > cap || page <= totalPages) return { items: items.slice(0, cap), total, truncated: true };
    return { items, total };
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/client.test.ts && npm run typecheck`
Expected: 19 tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts test/client.test.ts test/fakes.ts
git commit -F- <<'EOF'
feat: add Vikunja v2 HTTP client with Cloudflare-aware errors

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 5: Output shaping and due-date parsing

**Files:**
- Create: `src/output.ts`, `src/dates.ts`
- Test: `test/output.test.ts`, `test/dates.test.ts`

**Interfaces:**
- Consumes: `Page`, `AllItems` (`src/client.ts`), `usageError` (`src/errors.ts`).
- Produces (`src/output.ts`):
  - `type Obj = Record<string, any>`; `type Detail = 'list' | 'detail'`; `type Trim = (item: Obj) => Obj`
  - `const ZERO_DATE = '0001-01-01T00:00:00Z'`
  - `function normalizeDates<T>(value: T): T`: any string starting with `0001-01-01T` becomes `null`, recursively
  - `function trimProject(p: Obj, detail: Detail): Obj`
  - `function trimTask(t: Obj, detail: Detail): Obj`
  - `function trimLabel(l: Obj): Obj`
  - `function trimComment(c: Obj): Obj`
  - `function shapeOne(raw: Obj, full: boolean, trim: Trim): Obj`
  - `function shapeList(res: Page<Obj> | AllItems<Obj>, full: boolean, trim: Trim): Obj`
- Produces (`src/dates.ts`):
  - `function toLocalIso(d: Date): string`, formatted `YYYY-MM-DDTHH:MM:SS±HH:MM`
  - `function parseDue(input: string, allowNone: boolean): string | null`

- [ ] **Step 1: Write the failing test `test/output.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeDates, shapeList, shapeOne, trimComment, trimLabel, trimProject, trimTask } from '../src/output';

const rawTask = {
  $schema: 'https://vk.test/api/v2/schemas/Task.json',
  id: 5,
  title: 'Write spec',
  description: '**bold**',
  done: false,
  done_at: '0001-01-01T00:00:00Z',
  due_date: '2026-09-20T23:59:59+07:00',
  priority: 3,
  project_id: 2,
  created: '2026-09-15T10:00:00+07:00',
  updated: '2026-09-15T11:00:00+07:00',
  created_by: { id: 7, username: 'bot-planner', name: 'Planner' },
  labels: [{ id: 1, title: 'urgent', hex_color: 'e11d48', created: '2026-01-01T00:00:00Z' }],
  percent_done: 0,
};

describe('normalizeDates', () => {
  it('turns zero dates into null at any depth and keeps everything else', () => {
    expect(
      normalizeDates({
        a: '0001-01-01T00:00:00Z',
        b: '0001-01-01T00:00:00+00:00',
        c: '2026-09-15T10:00:00+07:00',
        list: [{ d: '0001-01-01T00:00:00Z' }],
        n: 0,
        s: null,
      }),
    ).toEqual({ a: null, b: null, c: '2026-09-15T10:00:00+07:00', list: [{ d: null }], n: 0, s: null });
  });
});

describe('trimmers', () => {
  it('trimTask list view', () => {
    expect(trimTask(normalizeDates(rawTask), 'list')).toEqual({
      id: 5,
      title: 'Write spec',
      done: false,
      project_id: 2,
      due_date: '2026-09-20T23:59:59+07:00',
      priority: 3,
      labels: [{ id: 1, title: 'urgent' }],
    });
  });

  it('trimTask detail view', () => {
    expect(trimTask(normalizeDates(rawTask), 'detail')).toEqual({
      id: 5,
      title: 'Write spec',
      done: false,
      project_id: 2,
      due_date: '2026-09-20T23:59:59+07:00',
      priority: 3,
      labels: [{ id: 1, title: 'urgent' }],
      description: '**bold**',
      created: '2026-09-15T10:00:00+07:00',
      updated: '2026-09-15T11:00:00+07:00',
      done_at: null,
      created_by: 'bot-planner',
    });
  });

  it('trimTask tolerates null labels and missing optional fields', () => {
    expect(trimTask({ id: 1, title: 't', project_id: 2, labels: null }, 'list')).toEqual({
      id: 1,
      title: 't',
      done: false,
      project_id: 2,
      due_date: null,
      priority: 0,
      labels: [],
    });
  });

  it('trimProject list and detail', () => {
    const raw = { id: 2, title: 'Home', description: 'desc', parent_project_id: 0, is_archived: false, hex_color: '' };
    expect(trimProject(raw, 'list')).toEqual({ id: 2, title: 'Home', parent_project_id: 0, is_archived: false });
    expect(trimProject(raw, 'detail')).toEqual({ id: 2, title: 'Home', parent_project_id: 0, is_archived: false, description: 'desc' });
  });

  it('trimLabel and trimComment', () => {
    expect(trimLabel({ id: 1, title: 'urgent', hex_color: 'e11d48', created_by: { username: 'x' } })).toEqual({
      id: 1,
      title: 'urgent',
      hex_color: 'e11d48',
    });
    expect(
      trimComment({ id: 9, comment: 'hi', author: { username: 'bot-reviewer' }, created: '2026-09-15T10:00:00Z', updated: 'x' }),
    ).toEqual({ id: 9, author: 'bot-reviewer', created: '2026-09-15T10:00:00Z', comment: 'hi' });
  });
});

describe('shapeOne / shapeList', () => {
  it('full output keeps every field but still normalizes dates', () => {
    const out = shapeOne(rawTask, true, (t) => trimTask(t, 'list'));
    expect(out.percent_done).toBe(0);
    expect(out.done_at).toBeNull();
  });

  it('page result keeps pagination fields and drops $schema', () => {
    const page = { $schema: 'x', items: [rawTask], page: 1, per_page: 50, total_pages: 1, total: 1 };
    expect(shapeList(page as never, false, (t) => trimTask(t, 'list'))).toEqual({
      items: [trimTask(normalizeDates(rawTask), 'list')],
      page: 1,
      per_page: 50,
      total_pages: 1,
      total: 1,
    });
  });

  it('all-items result keeps total and truncated', () => {
    expect(shapeList({ items: [], total: 9000, truncated: true }, false, trimLabel)).toEqual({ items: [], total: 9000, truncated: true });
    expect(shapeList({ items: [], total: 0 }, false, trimLabel)).toEqual({ items: [], total: 0 });
  });
});
```

- [ ] **Step 2: Write the failing test `test/dates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { parseDue } from '../src/dates';

// Fixed zone without DST so expectations are stable on any machine.
process.env.TZ = 'Asia/Ho_Chi_Minh';

describe('parseDue', () => {
  it.each([
    ['2026-09-20', '2026-09-20T23:59:59+07:00'],
    ['2026-09-20T09:30', '2026-09-20T09:30:00+07:00'],
    ['2026-09-20T09:30:15', '2026-09-20T09:30:15+07:00'],
    ['2026-09-20T09:30:00Z', '2026-09-20T09:30:00Z'],
    ['2026-09-20T09:30:00-05:00', '2026-09-20T09:30:00-05:00'],
  ])('%s -> %s', (input, expected) => {
    expect(parseDue(input, false)).toBe(expected);
  });

  const thrown = (fn: () => unknown): unknown => {
    try {
      fn();
    } catch (err) {
      return err;
    }
    throw new Error('expected an error to be thrown');
  };

  it('none clears the date only when allowed', () => {
    expect(parseDue('none', true)).toBeNull();
    expect(thrown(() => parseDue('none', false))).toMatchObject({ exitCode: 2 });
  });

  it.each(['tomorrow', '2026-02-30', '2026-13-01', '2026-09-20T25:00', '20-09-2026'])('rejects %s with exit 2', (input) => {
    expect(thrown(() => parseDue(input, true))).toMatchObject({ exitCode: 2, info: { title: 'invalid --due value' } });
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run test/output.test.ts test/dates.test.ts`
Expected: FAIL, cannot resolve `../src/output` and `../src/dates`.

- [ ] **Step 4: Implement `src/output.ts`**

```ts
import type { AllItems, Page } from './client';

export type Obj = Record<string, any>;
export type Detail = 'list' | 'detail';
export type Trim = (item: Obj) => Obj;

export const ZERO_DATE = '0001-01-01T00:00:00Z';
const ZERO_DATE_PREFIX = /^0001-01-01T/;

export function normalizeDates<T>(value: T): T {
  if (typeof value === 'string' && ZERO_DATE_PREFIX.test(value)) return null as T;
  if (Array.isArray(value)) return value.map((item) => normalizeDates(item)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDates(item)])) as T;
  }
  return value;
}

const username = (user: Obj | null | undefined): string | null => user?.username ?? null;

export function trimProject(p: Obj, detail: Detail): Obj {
  const out: Obj = {
    id: p.id,
    title: p.title,
    parent_project_id: p.parent_project_id ?? 0,
    is_archived: p.is_archived ?? false,
  };
  if (detail === 'detail') out.description = p.description ?? '';
  return out;
}

export function trimTask(t: Obj, detail: Detail): Obj {
  const out: Obj = {
    id: t.id,
    title: t.title,
    done: t.done ?? false,
    project_id: t.project_id,
    due_date: t.due_date ?? null,
    priority: t.priority ?? 0,
    labels: ((t.labels ?? []) as Obj[]).map((label) => ({ id: label.id, title: label.title })),
  };
  if (detail === 'detail') {
    Object.assign(out, {
      description: t.description ?? '',
      created: t.created,
      updated: t.updated,
      done_at: t.done_at ?? null,
      created_by: username(t.created_by),
    });
  }
  return out;
}

export function trimLabel(l: Obj): Obj {
  return { id: l.id, title: l.title, hex_color: l.hex_color ?? '' };
}

export function trimComment(c: Obj): Obj {
  return { id: c.id, author: username(c.author), created: c.created, comment: c.comment ?? '' };
}

export function shapeOne(raw: Obj, full: boolean, trim: Trim): Obj {
  const normalized = normalizeDates(raw);
  return full ? normalized : trim(normalized);
}

export function shapeList(res: Page<Obj> | AllItems<Obj>, full: boolean, trim: Trim): Obj {
  const items = (res.items ?? []).map((item) => shapeOne(item, full, trim));
  if ('page' in res) {
    return { items, page: res.page, per_page: res.per_page, total_pages: res.total_pages, total: res.total };
  }
  return res.truncated ? { items, total: res.total, truncated: true } : { items, total: res.total };
}
```

- [ ] **Step 5: Implement `src/dates.ts`**

```ts
import { usageError } from './errors';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalIso(d: Date): string {
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// Builds a local Date and rejects values that JavaScript would silently roll over (e.g. Feb 30).
function strictLocalDate([y, mo, d, h, mi, s]: number[]): Date | null {
  const date = new Date(y, mo - 1, d, h, mi, s);
  const exact =
    date.getFullYear() === y &&
    date.getMonth() === mo - 1 &&
    date.getDate() === d &&
    date.getHours() === h &&
    date.getMinutes() === mi &&
    date.getSeconds() === s;
  return exact ? date : null;
}

function invalid(input: string) {
  return usageError('invalid --due value', `got "${input}"; expected YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM] or none`);
}

export function parseDue(input: string, allowNone: boolean): string | null {
  if (input === 'none') {
    if (allowNone) return null;
    throw usageError('invalid --due value', '"none" is only allowed on `tasks update`');
  }
  const dateOnly = DATE_ONLY.exec(input);
  if (dateOnly) {
    const date = strictLocalDate([...dateOnly.slice(1).map(Number), 23, 59, 59]);
    if (date) return toLocalIso(date);
    throw invalid(input);
  }
  const local = LOCAL_DATETIME.exec(input);
  if (local) {
    const date = strictLocalDate(local.slice(1).map((part) => (part === undefined ? 0 : Number(part))));
    if (date) return toLocalIso(date);
    throw invalid(input);
  }
  if (OFFSET_DATETIME.test(input) && !Number.isNaN(Date.parse(input))) return input;
  throw invalid(input);
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run test/output.test.ts test/dates.test.ts && npm run typecheck`
Expected: 9 output tests and 11 date tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/output.ts src/dates.ts test/output.test.ts test/dates.test.ts
git commit -F- <<'EOF'
feat: add output trimming and due-date parsing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 6: CLI core, whoami and projects

**Files:**
- Create: `src/context.ts`, `src/commands/common.ts`, `src/cli.ts`, `src/commands/whoami.ts`, `src/commands/projects.ts`
- Create: `test/harness.ts`
- Test: `test/cli.test.ts`, `test/projects.test.ts`

**Interfaces:**
- Consumes: `VikunjaClient`, `FetchFn`, `Query` (`src/client.ts`); `loadConfig`, `resolveConnection`, `resolveIdentity`, `Env`, `Identity`, `Connection`, `ConfigFile` (`src/config.ts`); `Keychain`; `errorJson`, `usageError`; `shapeOne`, `shapeList`, `trimProject`, `Obj`, `Trim` (`src/output.ts`); `fakeFetch`, `jsonResponse`, `memoryKeychain` (`test/fakes.ts`).
- Produces (`src/context.ts`):
  - `interface Io { stdout(text: string): void; stderr(text: string): void }`
  - `interface Prompter { ask(question: string, options?: { hidden?: boolean }): Promise<string>; close(): void }`
  - `interface Deps { env: Env; keychain: Keychain; fetch: FetchFn; io: Io; prompter: Prompter }`
  - `interface ApiOptions { as?: string; full?: boolean }`
  - `function apiContext(deps: Deps, opts: ApiOptions): Promise<{ client: VikunjaClient; identity: Identity; connection: Connection }>`
  - `function print(deps: Deps, value: unknown): void`
- Produces (`src/commands/common.ts`):
  - `const MARKDOWN = { format: 'markdown' }`
  - `interface ListOptions extends ApiOptions { page?: string; perPage?: string; all?: boolean }`
  - `interface ListParams { all: boolean; page: number; perPage: number; full: boolean }`
  - `function withApi(cmd: Command): Command` (adds `--as <profile>`, `--full`)
  - `function withList(cmd: Command): Command` (withApi plus `--page <n>`, `--per-page <n>`, `--all`)
  - `function parseId(value: string, what?: string): number`
  - `function parsePriority(value: string): number`
  - `function requireYes(yes: boolean | undefined): void`
  - `function requireChanges(patch: Obj, flags: string): void`
  - `function parseListOptions(opts: ListOptions): ListParams`
  - `function listAndShape(client: VikunjaClient, path: string, query: Query, params: ListParams, trim: Trim): Promise<Obj>`
  - `function patchAndReread(client: VikunjaClient, path: string, patch: Obj): Promise<Obj>`
- Produces (`src/cli.ts`): `const VERSION = '0.1.0'`, `function buildProgram(deps: Deps, captureErr?: (text: string) => void): Command`, `function runCli(argv: string[], deps: Deps): Promise<number>`
- Produces (`src/commands/*.ts`): `registerWhoami(program: Command, deps: Deps): void`, `registerProjects(program: Command, deps: Deps): void`
- Produces (`test/harness.ts`): `harness(options?: { env?: Env; config?: ConfigFile | null; secrets?: Record<string, string>; answers?: string[] })` resolving to `{ run(...argv: string[]): Promise<{ code: number; stdout: string; stderr: string; out: any; err: any }>; env: Env; keychain; calls: FetchCall[]; reply(...responses: Array<Response | Error>): void; prompts: Array<{ question: string; hidden: boolean }>; configHome: string }`. `out` is parsed stdout JSON; `err` is the parsed stderr `error` object. The default config is `{ url: 'https://vk.test', default_profile: 'me', profiles: { me: { username: 'trung' } } }`; default secrets are `cf:client-id=cf-id`, `cf:client-secret=cf-secret`, `profile:me=tk_me`.

Rule for every command action: validate and parse all arguments **before** calling `apiContext`, so usage errors exit 2 without needing config or making requests.

- [ ] **Step 1: Create `test/harness.ts`**

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli';
import type { ConfigFile, Env } from '../src/config';
import type { Deps } from '../src/context';
import { fakeFetch, memoryKeychain } from './fakes';

export const DEFAULT_CONFIG: ConfigFile = {
  url: 'https://vk.test',
  default_profile: 'me',
  profiles: { me: { username: 'trung' } },
};

export const DEFAULT_SECRETS: Record<string, string> = {
  'cf:client-id': 'cf-id',
  'cf:client-secret': 'cf-secret',
  'profile:me': 'tk_me',
};

export interface HarnessOptions {
  env?: Env;
  config?: ConfigFile | null;
  secrets?: Record<string, string>;
  answers?: string[];
}

function parseJson(text: string) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export async function harness(options: HarnessOptions = {}) {
  const configHome = await mkdtemp(join(tmpdir(), 'vikunja-cli-test-'));
  const env: Env = { XDG_CONFIG_HOME: configHome, ...options.env };
  const config = options.config === undefined ? DEFAULT_CONFIG : options.config;
  if (config) {
    await mkdir(join(configHome, 'vikunja-cli'), { recursive: true });
    await writeFile(join(configHome, 'vikunja-cli', 'config.json'), JSON.stringify(config));
  }
  const keychain = memoryKeychain(options.secrets ?? DEFAULT_SECRETS);
  const http = fakeFetch();
  const answers = [...(options.answers ?? [])];
  const prompts: Array<{ question: string; hidden: boolean }> = [];

  async function run(...argv: string[]) {
    let stdout = '';
    let stderr = '';
    const deps: Deps = {
      env,
      keychain,
      fetch: http.fn,
      io: {
        stdout: (text) => void (stdout += text),
        stderr: (text) => void (stderr += text),
      },
      prompter: {
        async ask(question, opts) {
          prompts.push({ question, hidden: Boolean(opts?.hidden) });
          return answers.shift() ?? '';
        },
        close() {},
      },
    };
    const code = await runCli(argv, deps);
    return { code, stdout, stderr, out: parseJson(stdout) as any, err: parseJson(stderr)?.error as any };
  }

  return { run, env, keychain, calls: http.calls, reply: http.queue, prompts, configHome };
}
```

- [ ] **Step 2: Write the failing test `test/cli.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { DEFAULT_SECRETS, harness } from './harness';

describe('cli basics', () => {
  it('--version prints the version', async () => {
    const h = await harness();
    const r = await h.run('--version');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('0.1.0\n');
  });

  it('a missing subcommand is exit 2 with a JSON error', async () => {
    const h = await harness();
    const r = await h.run('projects');
    expect(r.code).toBe(2);
    expect(r.err.title).toBe('missing subcommand');
    expect(r.stdout).toBe('');
  });

  it('an unknown option is exit 2', async () => {
    const h = await harness();
    const r = await h.run('whoami', '--bogus');
    expect(r.code).toBe(2);
    expect(r.err.title).toContain('unknown option');
  });

  it('config errors are exit 3', async () => {
    const h = await harness({ config: null, secrets: {} });
    const r = await h.run('whoami');
    expect(r.code).toBe(3);
    expect(r.err.title).toBe('no profile configured');
  });
});

describe('whoami', () => {
  it('prints profile, user and url', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { id: 7, username: 'trung', email: 'x@y.z' }));
    const r = await h.run('whoami');
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ profile: 'me', user_id: 7, username: 'trung', url: 'https://vk.test' });
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/user');
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_me');
  });

  it('--as switches the token', async () => {
    const h = await harness({ secrets: { ...DEFAULT_SECRETS, 'profile:reviewer': 'tk_rev' } });
    h.reply(jsonResponse(200, { id: 8, username: 'bot-reviewer' }));
    const r = await h.run('whoami', '--as', 'reviewer');
    expect(r.out.profile).toBe('reviewer');
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_rev');
  });

  it('--as is rejected when the session is locked', async () => {
    const h = await harness({ env: { VIKUNJA_PROFILE_LOCK: '1' } });
    const r = await h.run('whoami', '--as', 'reviewer');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Write the failing test `test/projects.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const project = { id: 2, title: 'Home', description: 'desc', parent_project_id: 0, is_archived: false, hex_color: '' };
const page = (items: unknown[], pageNo = 1, totalPages = 1, total = items.length) =>
  jsonResponse(200, { items, page: pageNo, per_page: 50, total_pages: totalPages, total });
const query = (url: string) => new URL(url).searchParams;

describe('projects', () => {
  it('list sends search, archived, markdown and pagination', async () => {
    const h = await harness();
    h.reply(page([project]));
    const r = await h.run('projects', 'list', '--search', 'ho', '--archived');
    expect(new URL(h.calls[0].url).pathname).toBe('/api/v2/projects');
    const q = query(h.calls[0].url);
    expect([q.get('format'), q.get('q'), q.get('is_archived'), q.get('page'), q.get('per_page')]).toEqual([
      'markdown', 'ho', 'true', '1', '50',
    ]);
    expect(r.out).toEqual({
      items: [{ id: 2, title: 'Home', parent_project_id: 0, is_archived: false }],
      page: 1,
      per_page: 50,
      total_pages: 1,
      total: 1,
    });
  });

  it('list without --archived omits is_archived', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('projects', 'list');
    expect(query(h.calls[0].url).has('is_archived')).toBe(false);
  });

  it('list --all fetches every page', async () => {
    const h = await harness();
    h.reply(page([project], 1, 2, 2), page([{ ...project, id: 3 }], 2, 2, 2));
    const r = await h.run('projects', 'list', '--all');
    expect(r.out.items.map((p: { id: number }) => p.id)).toEqual([2, 3]);
    expect(r.out.total).toBe(2);
  });

  it('list rejects --per-page over 1000 before calling the API', async () => {
    const h = await harness();
    const r = await h.run('projects', 'list', '--per-page', '5000');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('get prints the detail view', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project));
    const r = await h.run('projects', 'get', '2');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/projects/2?format=markdown');
    expect(r.out).toEqual({ id: 2, title: 'Home', parent_project_id: 0, is_archived: false, description: 'desc' });
  });

  it('get --full prints the raw object', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project));
    const r = await h.run('projects', 'get', '2', '--full');
    expect(r.out.hex_color).toBe('');
  });

  it('get rejects a non-numeric id', async () => {
    const h = await harness();
    const r = await h.run('projects', 'get', 'abc');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('create posts title, description and parent', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, { ...project, id: 9, title: 'Work', parent_project_id: 2 }));
    const r = await h.run('projects', 'create', '--title', 'Work', '--description', '**x**', '--parent', '2');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/projects?format=markdown',
      body: { title: 'Work', description: '**x**', parent_project_id: 2 },
    });
    expect(r.out.id).toBe(9);
  });

  it('update with a description patches with the markdown header and re-reads', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { ...project, description: '<p>new</p>' }), jsonResponse(200, { ...project, description: 'new' }));
    const r = await h.run('projects', 'update', '2', '--description', 'new');
    expect(h.calls[0]).toMatchObject({ method: 'PATCH', url: 'https://vk.test/api/v2/projects/2', body: { description: 'new' } });
    expect(h.calls[0].headers['X-Vikunja-Format']).toBe('markdown');
    expect(h.calls[1]).toMatchObject({ method: 'GET', url: 'https://vk.test/api/v2/projects/2?format=markdown' });
    expect(r.out.description).toBe('new');
  });

  it('update without a description sends no format header', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project), jsonResponse(200, project));
    await h.run('projects', 'update', '2', '--title', 'Renamed');
    expect(h.calls[0].body).toEqual({ title: 'Renamed' });
    expect(h.calls[0].headers['X-Vikunja-Format']).toBeUndefined();
  });

  it('update with nothing to change is exit 2', async () => {
    const h = await harness();
    const r = await h.run('projects', 'update', '2');
    expect(r.code).toBe(2);
    expect(r.err.title).toBe('nothing to update');
  });

  it('archive and unarchive patch is_archived', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, project), jsonResponse(200, { ...project, is_archived: true }));
    const archived = await h.run('projects', 'archive', '2');
    h.reply(jsonResponse(200, project), jsonResponse(200, project));
    await h.run('projects', 'unarchive', '2');
    expect(h.calls[0].body).toEqual({ is_archived: true });
    expect(archived.out.is_archived).toBe(true);
    expect(h.calls[2].body).toEqual({ is_archived: false });
  });

  it('delete requires --yes', async () => {
    const h = await harness();
    const r = await h.run('projects', 'delete', '2');
    expect(r.code).toBe(2);
    expect(r.err.title).toBe('refusing to delete without --yes');
    expect(h.calls).toHaveLength(0);
  });

  it('delete --yes deletes', async () => {
    const h = await harness();
    h.reply(jsonResponse(204));
    const r = await h.run('projects', 'delete', '2', '--yes');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/projects/2' });
    expect(r.out).toEqual({ deleted: true, id: 2 });
  });
});
```

- [ ] **Step 4: Run both tests to verify they fail**

Run: `npx vitest run test/cli.test.ts test/projects.test.ts`
Expected: FAIL, cannot resolve `../src/cli`.

- [ ] **Step 5: Implement `src/context.ts`**

```ts
import { VikunjaClient, type FetchFn } from './client';
import { loadConfig, resolveConnection, resolveIdentity, type Connection, type Env, type Identity } from './config';
import type { Keychain } from './keychain';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface Prompter {
  ask(question: string, options?: { hidden?: boolean }): Promise<string>;
  close(): void;
}

export interface Deps {
  env: Env;
  keychain: Keychain;
  fetch: FetchFn;
  io: Io;
  prompter: Prompter;
}

export interface ApiOptions {
  as?: string;
  full?: boolean;
}

export async function apiContext(
  deps: Deps,
  opts: ApiOptions,
): Promise<{ client: VikunjaClient; identity: Identity; connection: Connection }> {
  const cfg = await loadConfig(deps.env);
  // Identity first: a locked-profile violation (exit 2) must win over missing config.
  const identity = await resolveIdentity(opts.as, deps.env, deps.keychain, cfg);
  const connection = await resolveConnection(deps.env, deps.keychain, cfg);
  const client = new VikunjaClient({ connection, token: identity.token, profile: identity.profile, fetch: deps.fetch });
  return { client, identity, connection };
}

export function print(deps: Deps, value: unknown): void {
  deps.io.stdout(`${JSON.stringify(value)}\n`);
}
```

- [ ] **Step 6: Implement `src/commands/common.ts`**

```ts
import type { Command } from 'commander';
import type { Query, VikunjaClient } from '../client';
import type { ApiOptions } from '../context';
import { usageError } from '../errors';
import { shapeList, type Obj, type Trim } from '../output';

export const MARKDOWN = { format: 'markdown' };

export interface ListOptions extends ApiOptions {
  page?: string;
  perPage?: string;
  all?: boolean;
}

export interface ListParams {
  all: boolean;
  page: number;
  perPage: number;
  full: boolean;
}

export function withApi(cmd: Command): Command {
  return cmd
    .option('--as <profile>', 'act as this Vikunja profile')
    .option('--full', 'print the complete API object');
}

export function withList(cmd: Command): Command {
  return withApi(cmd)
    .option('--page <n>', 'page number (default 1)')
    .option('--per-page <n>', 'items per page (default 50, max 1000)')
    .option('--all', 'fetch every page (max 5000 items)');
}

export function parseId(value: string, what = 'id'): number {
  if (!/^[1-9]\d*$/.test(value)) throw usageError(`invalid ${what}: ${value}`, 'expected a positive integer');
  return Number(value);
}

export function parsePriority(value: string): number {
  if (!/^[0-5]$/.test(value)) throw usageError(`invalid --priority: ${value}`, 'expected an integer from 0 to 5');
  return Number(value);
}

export function requireYes(yes: boolean | undefined): void {
  if (!yes) throw usageError('refusing to delete without --yes');
}

export function requireChanges(patch: Obj, flags: string): void {
  if (Object.keys(patch).length === 0) throw usageError('nothing to update', `pass at least one of ${flags}`);
}

export function parseListOptions(opts: ListOptions): ListParams {
  const perPage = opts.perPage === undefined ? 50 : parseId(opts.perPage, '--per-page');
  if (perPage > 1000) throw usageError(`invalid --per-page: ${perPage}`, 'maximum is 1000');
  const page = opts.page === undefined ? 1 : parseId(opts.page, '--page');
  return { all: Boolean(opts.all), page, perPage, full: Boolean(opts.full) };
}

export async function listAndShape(
  client: VikunjaClient,
  path: string,
  query: Query,
  params: ListParams,
  trim: Trim,
): Promise<Obj> {
  if (params.all) {
    return shapeList(await client.listAll<Obj>(path, { ...query, per_page: params.perPage }), params.full, trim);
  }
  const res = await client.listPage<Obj>(path, { ...query, page: params.page, per_page: params.perPage });
  return shapeList(res, params.full, trim);
}

// A PATCH round-trips the whole resource, so the markdown header is only safe when the
// description itself is being replaced. The re-read makes the printed result Markdown.
export async function patchAndReread(client: VikunjaClient, path: string, patch: Obj): Promise<Obj> {
  const headers = 'description' in patch ? { 'X-Vikunja-Format': 'markdown' } : undefined;
  await client.request('PATCH', path, { body: patch, headers });
  return client.request<Obj>('GET', path, { query: MARKDOWN });
}
```

- [ ] **Step 7: Implement `src/commands/whoami.ts`**

```ts
import type { Command } from 'commander';
import { apiContext, print, type ApiOptions, type Deps } from '../context';
import type { Obj } from '../output';

export function registerWhoami(program: Command, deps: Deps): void {
  program
    .command('whoami')
    .description('show the profile in use and the Vikunja user it maps to')
    .option('--as <profile>', 'act as this Vikunja profile')
    .action(async (opts: ApiOptions) => {
      const { client, identity, connection } = await apiContext(deps, opts);
      const user = await client.request<Obj>('GET', '/user');
      print(deps, { profile: identity.profile, user_id: user.id, username: user.username, url: connection.url });
    });
}
```

- [ ] **Step 8: Implement `src/commands/projects.ts`**

```ts
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
```

- [ ] **Step 9: Implement `src/cli.ts`**

```ts
import { Command, CommanderError } from 'commander';
import { registerProjects } from './commands/projects';
import { registerWhoami } from './commands/whoami';
import type { Deps } from './context';
import { errorJson } from './errors';

export const VERSION = '0.1.0';

export function buildProgram(deps: Deps, captureErr: (text: string) => void = () => {}): Command {
  const program = new Command('vikunja')
    .description('Vikunja CLI for AI agents (API v2, Cloudflare Access, multiple profiles). Prints JSON.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: (text) => deps.io.stdout(text), writeErr: captureErr, outputError: () => {} });
  registerWhoami(program, deps);
  registerProjects(program, deps);
  return program;
}

export async function runCli(argv: string[], deps: Deps): Promise<number> {
  let captured = '';
  const program = buildProgram(deps, (text) => {
    captured += text;
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) return 0; // --help, --version
      const error =
        err.code === 'commander.help'
          ? { title: 'missing subcommand', detail: captured.trim() }
          : { title: err.message.replace(/^error: /, ''), detail: 'run with --help for usage' };
      deps.io.stderr(`${JSON.stringify({ error })}\n`);
      return 2;
    }
    const { exitCode, json } = errorJson(err);
    deps.io.stderr(`${json}\n`);
    return exitCode;
  } finally {
    deps.prompter.close();
  }
}
```

- [ ] **Step 10: Run tests and typecheck**

Run: `npx vitest run test/cli.test.ts test/projects.test.ts && npm run typecheck`
Expected: 7 cli tests and 14 projects tests PASS; typecheck exits 0.
If "a missing subcommand" fails because commander 14 uses a different error code than `commander.help`, log `err.code` for that case, use the code commander actually reports in `runCli`, and re-run.

- [ ] **Step 11: Run the full suite and commit**

Run: `npm test`
Expected: all tests PASS.

```bash
git add src/context.ts src/cli.ts src/commands test/harness.ts test/cli.test.ts test/projects.test.ts
git commit -F- <<'EOF'
feat: add CLI core with whoami and projects commands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 7: Tasks commands

**Files:**
- Create: `src/commands/tasks.ts`
- Modify: `src/cli.ts` (register tasks)
- Test: `test/tasks.test.ts`

**Interfaces:**
- Consumes: everything from `src/commands/common.ts` (Task 6), `apiContext`, `print`, `ApiOptions`, `Deps` (`src/context.ts`), `parseDue` (`src/dates.ts`), `usageError`, `shapeOne`, `trimTask`, `Obj`, `harness`, `jsonResponse`.
- Produces: `function registerTasks(program: Command, deps: Deps): void`, `function parseSorts(values: string[]): { sort_by?: string[]; order_by?: string[] }`

- [ ] **Step 1: Write the failing test `test/tasks.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const task = {
  id: 5,
  title: 'Write spec',
  description: 'hello',
  done: false,
  done_at: '0001-01-01T00:00:00Z',
  due_date: '0001-01-01T00:00:00Z',
  priority: 2,
  project_id: 4,
  created: '2026-09-15T10:00:00Z',
  updated: '2026-09-15T10:00:00Z',
  created_by: { id: 1, username: 'trung' },
  labels: null,
};
const page = (items: unknown[]) => jsonResponse(200, { items, page: 1, per_page: 50, total_pages: 1, total: items.length });
const url = (u: string) => new URL(u);

describe('tasks list', () => {
  it('defaults to open tasks across all projects', async () => {
    const h = await harness();
    h.reply(page([task]));
    const r = await h.run('tasks', 'list');
    const u = url(h.calls[0].url);
    expect(u.pathname).toBe('/api/v2/tasks');
    expect(u.searchParams.get('filter')).toBe('done = false');
    expect(u.searchParams.get('format')).toBe('markdown');
    expect(u.searchParams.has('sort_by')).toBe(false);
    expect(r.out.items).toEqual([
      { id: 5, title: 'Write spec', done: false, project_id: 4, due_date: null, priority: 2, labels: [] },
    ]);
  });

  it('--project scopes to one project', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--project', '4');
    expect(url(h.calls[0].url).pathname).toBe('/api/v2/projects/4/tasks');
  });

  it('--filter is sent as-is without the implicit done filter', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--filter', 'priority >= 3 && due_date < now+7d');
    expect(url(h.calls[0].url).searchParams.getAll('filter')).toEqual(['priority >= 3 && due_date < now+7d']);
  });

  it('--include-done drops the implicit filter', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--include-done');
    expect(url(h.calls[0].url).searchParams.has('filter')).toBe(false);
  });

  it('--sort is repeatable and paired', async () => {
    const h = await harness();
    h.reply(page([]));
    await h.run('tasks', 'list', '--sort', 'due_date:asc', '--sort', 'id:desc', '--search', 'spec');
    const q = url(h.calls[0].url).searchParams;
    expect(q.getAll('sort_by')).toEqual(['due_date', 'id']);
    expect(q.getAll('order_by')).toEqual(['asc', 'desc']);
    expect(q.get('q')).toBe('spec');
  });

  it('rejects a malformed --sort before calling the API', async () => {
    const h = await harness();
    const r = await h.run('tasks', 'list', '--sort', 'due_date');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('tasks get/create', () => {
  it('get prints the detail view', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task));
    const r = await h.run('tasks', 'get', '5');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/tasks/5?format=markdown');
    expect(r.out).toMatchObject({ id: 5, description: 'hello', done_at: null, created_by: 'trung' });
  });

  it('create posts all fields to the project', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, task));
    await h.run(
      'tasks', 'create', '--project', '4', '--title', 'Write spec', '--description', '# Hi',
      '--due', '2026-09-20T09:00:00Z', '--priority', '3',
    );
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/projects/4/tasks?format=markdown',
      body: { title: 'Write spec', description: '# Hi', due_date: '2026-09-20T09:00:00Z', priority: 3 },
    });
  });

  it('create requires --project', async () => {
    const h = await harness();
    const r = await h.run('tasks', 'create', '--title', 'x');
    expect(r.code).toBe(2);
    expect(r.err.title).toContain('--project');
  });

  it('create rejects an out-of-range priority and --due none', async () => {
    const h = await harness();
    expect((await h.run('tasks', 'create', '--project', '4', '--title', 'x', '--priority', '7')).code).toBe(2);
    expect((await h.run('tasks', 'create', '--project', '4', '--title', 'x', '--due', 'none')).code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('tasks update/done/delete', () => {
  it('update --due none clears the date, sends no format header, and re-reads', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task), jsonResponse(200, task));
    const r = await h.run('tasks', 'update', '5', '--due', 'none', '--title', 'New');
    expect(h.calls[0]).toMatchObject({ method: 'PATCH', url: 'https://vk.test/api/v2/tasks/5', body: { title: 'New', due_date: null } });
    expect(h.calls[0].headers['X-Vikunja-Format']).toBeUndefined();
    expect(h.calls[1].url).toBe('https://vk.test/api/v2/tasks/5?format=markdown');
    expect(r.out.due_date).toBeNull();
  });

  it('update --description sends the markdown header', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task), jsonResponse(200, task));
    await h.run('tasks', 'update', '5', '--description', 'new');
    expect(h.calls[0].headers['X-Vikunja-Format']).toBe('markdown');
  });

  it('update with nothing to change is exit 2', async () => {
    const h = await harness();
    expect((await h.run('tasks', 'update', '5')).code).toBe(2);
  });

  it('done and undone patch the done flag', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, task), jsonResponse(200, { ...task, done: true }));
    const done = await h.run('tasks', 'done', '5');
    h.reply(jsonResponse(200, task), jsonResponse(200, task));
    await h.run('tasks', 'undone', '5');
    expect(h.calls[0].body).toEqual({ done: true });
    expect(done.out.done).toBe(true);
    expect(h.calls[2].body).toEqual({ done: false });
  });

  it('delete requires --yes, then deletes', async () => {
    const h = await harness();
    expect((await h.run('tasks', 'delete', '5')).code).toBe(2);
    h.reply(jsonResponse(204));
    const r = await h.run('tasks', 'delete', '5', '--yes');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/tasks/5' });
    expect(r.out).toEqual({ deleted: true, id: 5 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/tasks.test.ts`
Expected: FAIL. Every command exits 2 with `unknown command 'tasks'`, so assertions on `calls` and `out` fail.

- [ ] **Step 3: Implement `src/commands/tasks.ts`**

```ts
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
```

- [ ] **Step 4: Register tasks in `src/cli.ts`**

Add the import next to the other command imports:
```ts
import { registerTasks } from './commands/tasks';
```
Add the call directly after `registerProjects(program, deps);`:
```ts
  registerTasks(program, deps);
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/tasks.test.ts && npm test && npm run typecheck`
Expected: 15 tasks tests PASS, full suite PASS, typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/commands/tasks.ts src/cli.ts test/tasks.test.ts
git commit -F- <<'EOF'
feat: add tasks commands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 8: Labels and comments commands

**Files:**
- Create: `src/commands/labels.ts`, `src/commands/comments.ts`
- Modify: `src/cli.ts` (register both)
- Test: `test/labels.test.ts`, `test/comments.test.ts`

**Interfaces:**
- Consumes: `withApi`, `withList`, `parseId`, `parseListOptions`, `listAndShape`, `requireYes`, `MARKDOWN`, `ListOptions` (`src/commands/common.ts`); `apiContext`, `print`, `ApiOptions`, `Deps`; `usageError`; `shapeOne`, `trimLabel`, `trimComment`, `Obj`; `harness`, `DEFAULT_SECRETS`, `jsonResponse`.
- Produces: `function registerLabels(program: Command, deps: Deps): void`, `function registerComments(program: Command, deps: Deps): void`

- [ ] **Step 1: Write the failing test `test/labels.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { harness } from './harness';

const label = { id: 3, title: 'urgent', hex_color: 'e11d48', description: '', created_by: { username: 'trung' } };

describe('labels', () => {
  it('list searches and trims', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { items: [label], page: 1, per_page: 50, total_pages: 1, total: 1 }));
    const r = await h.run('labels', 'list', '--search', 'urg');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/labels?q=urg&page=1&per_page=50');
    expect(r.out.items).toEqual([{ id: 3, title: 'urgent', hex_color: 'e11d48' }]);
  });

  it('create normalizes the color', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, label));
    const r = await h.run('labels', 'create', '--title', 'urgent', '--color', '#E11D48');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/labels',
      body: { title: 'urgent', hex_color: 'e11d48' },
    });
    expect(r.out).toEqual({ id: 3, title: 'urgent', hex_color: 'e11d48' });
  });

  it('create rejects an invalid color before calling the API', async () => {
    const h = await harness();
    const r = await h.run('labels', 'create', '--title', 'x', '--color', 'red');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('delete requires --yes, then deletes', async () => {
    const h = await harness();
    expect((await h.run('labels', 'delete', '3')).code).toBe(2);
    h.reply(jsonResponse(204));
    const r = await h.run('labels', 'delete', '3', '--yes');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/labels/3' });
    expect(r.out).toEqual({ deleted: true, id: 3 });
  });

  it('add attaches a label to a task', async () => {
    const h = await harness();
    h.reply(jsonResponse(201, { label_id: 3, created: '2026-09-15T10:00:00Z' }));
    const r = await h.run('labels', 'add', '5', '3');
    expect(h.calls[0]).toMatchObject({ method: 'POST', url: 'https://vk.test/api/v2/tasks/5/labels', body: { label_id: 3 } });
    expect(r.out).toEqual({ task_id: 5, label_id: 3, added: true });
  });

  it('remove detaches a label from a task', async () => {
    const h = await harness();
    h.reply(jsonResponse(204));
    const r = await h.run('labels', 'remove', '5', '3');
    expect(h.calls[0]).toMatchObject({ method: 'DELETE', url: 'https://vk.test/api/v2/tasks/5/labels/3' });
    expect(r.out).toEqual({ task_id: 5, label_id: 3, removed: true });
  });

  it('add rejects a non-numeric label id', async () => {
    const h = await harness();
    const r = await h.run('labels', 'add', '5', 'urgent');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the failing test `test/comments.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { jsonResponse } from './fakes';
import { DEFAULT_SECRETS, harness } from './harness';

const comment = {
  id: 9,
  comment: 'LGTM **ship it**',
  author: { id: 8, username: 'bot-reviewer' },
  created: '2026-09-15T10:00:00Z',
  updated: '2026-09-15T10:00:00Z',
};

describe('comments', () => {
  it('list reads markdown comments for a task', async () => {
    const h = await harness();
    h.reply(jsonResponse(200, { items: [comment], page: 1, per_page: 50, total_pages: 1, total: 1 }));
    const r = await h.run('comments', 'list', '5');
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/tasks/5/comments?format=markdown&page=1&per_page=50');
    expect(r.out.items).toEqual([
      { id: 9, author: 'bot-reviewer', created: '2026-09-15T10:00:00Z', comment: 'LGTM **ship it**' },
    ]);
  });

  it('add posts markdown as the chosen profile', async () => {
    const h = await harness({ secrets: { ...DEFAULT_SECRETS, 'profile:reviewer': 'tk_rev' } });
    h.reply(jsonResponse(201, comment));
    const r = await h.run('comments', 'add', '5', '--text', 'LGTM **ship it**', '--as', 'reviewer');
    expect(h.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://vk.test/api/v2/tasks/5/comments?format=markdown',
      body: { comment: 'LGTM **ship it**' },
    });
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_rev');
    expect(r.out.author).toBe('bot-reviewer');
  });

  it('add requires --text', async () => {
    const h = await harness();
    const r = await h.run('comments', 'add', '5');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run test/labels.test.ts test/comments.test.ts`
Expected: FAIL (`unknown command 'labels'` / `'comments'`, so assertions on calls and output fail).

- [ ] **Step 4: Implement `src/commands/labels.ts`**

```ts
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
```

- [ ] **Step 5: Implement `src/commands/comments.ts`**

```ts
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
```

- [ ] **Step 6: Register both in `src/cli.ts`**

Add the imports next to the other command imports:
```ts
import { registerComments } from './commands/comments';
import { registerLabels } from './commands/labels';
```
Add the calls directly after `registerTasks(program, deps);`:
```ts
  registerLabels(program, deps);
  registerComments(program, deps);
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run test/labels.test.ts test/comments.test.ts && npm test && npm run typecheck`
Expected: 7 labels tests and 3 comments tests PASS, full suite PASS, typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/commands/labels.ts src/commands/comments.ts src/cli.ts test/labels.test.ts test/comments.test.ts
git commit -F- <<'EOF'
feat: add labels and comments commands

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 9: Setup, profiles, prompts and entry point

**Files:**
- Create: `src/prompt.ts`, `src/commands/setup.ts`, `src/commands/profile.ts`, `src/main.ts`
- Modify: `src/cli.ts` (register setup and profile)
- Test: `test/setup.test.ts`, `test/profile.test.ts`

**Interfaces:**
- Consumes: `VikunjaClient` (`src/client.ts`); `loadConfig`, `saveConfig`, `normalizeUrl`, `resolveConnection`, `ACCOUNT_CF_ID`, `ACCOUNT_CF_SECRET`, `PROFILE_NAME`, `profileAccount`, `ConfigFile` (`src/config.ts`); `securityKeychain` (`src/keychain.ts`); `Deps`, `Prompter`, `print` (`src/context.ts`); `CliError`, `usageError`; `Obj`; `runCli` (`src/cli.ts`); `harness`, `DEFAULT_CONFIG`, `DEFAULT_SECRETS`, `jsonResponse`.
- Produces:
  - `function terminalPrompter(input?: NodeJS.ReadStream, output?: NodeJS.WriteStream): Prompter`. On a TTY it shows the question on stderr and hides typed input when `hidden`; otherwise it reads one stdin line per `ask` without printing the question.
  - `function registerSetup(program: Command, deps: Deps): void`
  - `function registerProfile(program: Command, deps: Deps): void`
  - `src/main.ts`: the executable entry point (no exports)

- [ ] **Step 1: Write the failing test `test/setup.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { jsonResponse } from './fakes';
import { DEFAULT_CONFIG, harness } from './harness';

describe('setup', () => {
  it('verifies through Cloudflare, then stores URL and credentials', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['https://vk.test/', 'abc.access', 'sec123'] });
    h.reply(jsonResponse(200, { version: 'v2.6.0' }));
    const r = await h.run('setup');
    expect(r.code).toBe(0);
    expect(r.out).toEqual({ ok: true, url: 'https://vk.test', vikunja_version: 'v2.6.0' });
    expect(h.calls[0].url).toBe('https://vk.test/api/v2/info');
    expect(h.calls[0].headers).toMatchObject({ 'CF-Access-Client-Id': 'abc.access', 'CF-Access-Client-Secret': 'sec123' });
    expect(h.calls[0].headers.Authorization).toBeUndefined();
    expect(h.keychain.items.get('cf:client-id')).toBe('abc.access');
    expect(h.keychain.items.get('cf:client-secret')).toBe('sec123');
    expect((await loadConfig(h.env)).url).toBe('https://vk.test');
    expect(h.prompts.map((p) => p.hidden)).toEqual([false, false, true]);
    expect(r.stdout).not.toContain('sec123');
  });

  it('stores nothing when Cloudflare rejects the credentials', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['https://vk.test', 'abc.access', 'wrong'] });
    h.reply(new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const r = await h.run('setup');
    expect(r.code).toBe(3);
    expect(h.keychain.items.size).toBe(0);
    expect(await loadConfig(h.env)).toEqual({ profiles: {} });
  });

  it('rejects an invalid URL before any request', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['vk.test', 'abc.access', 'sec123'] });
    const r = await h.run('setup');
    expect(r.code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('requires both client ID and secret', async () => {
    const h = await harness({ config: null, secrets: {}, answers: ['https://vk.test', 'abc.access', ''] });
    expect((await h.run('setup')).code).toBe(2);
  });

  it('keeps existing profiles', async () => {
    const h = await harness({ answers: ['https://new.test', 'abc.access', 'sec123'] });
    h.reply(jsonResponse(200, { version: 'v2.6.0' }));
    await h.run('setup');
    expect(await loadConfig(h.env)).toEqual({ ...DEFAULT_CONFIG, url: 'https://new.test' });
  });
});
```

- [ ] **Step 2: Write the failing test `test/profile.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { jsonResponse } from './fakes';
import { DEFAULT_CONFIG, DEFAULT_SECRETS, harness } from './harness';

const CF_ONLY = { 'cf:client-id': 'cf-id', 'cf:client-secret': 'cf-secret' };

describe('profile add', () => {
  it('verifies the token, stores it, and makes the first profile the default', async () => {
    const h = await harness({ config: { url: 'https://vk.test', profiles: {} }, secrets: CF_ONLY, answers: ['tk_new'] });
    h.reply(jsonResponse(200, { id: 7, username: 'bot-planner' }));
    const r = await h.run('profile', 'add', 'planner');
    expect(r.out).toEqual({ name: 'planner', username: 'bot-planner', default: true });
    expect(h.calls[0].headers.Authorization).toBe('Bearer tk_new');
    expect(h.prompts).toEqual([{ question: 'Vikunja API token for planner: ', hidden: true }]);
    expect(h.keychain.items.get('profile:planner')).toBe('tk_new');
    expect(await loadConfig(h.env)).toEqual({
      url: 'https://vk.test',
      default_profile: 'planner',
      profiles: { planner: { username: 'bot-planner' } },
    });
    expect(r.stdout).not.toContain('tk_new');
  });

  it('does not change an existing default', async () => {
    const h = await harness({ answers: ['tk_rev'] });
    h.reply(jsonResponse(200, { id: 8, username: 'bot-reviewer' }));
    const r = await h.run('profile', 'add', 'reviewer');
    expect(r.out.default).toBe(false);
    expect((await loadConfig(h.env)).default_profile).toBe('me');
  });

  it('stores nothing when the token is rejected', async () => {
    const h = await harness({ answers: ['tk_bad'] });
    h.reply(jsonResponse(401, { title: 'Unauthorized', status: 401 }, 'application/problem+json'));
    const r = await h.run('profile', 'add', 'reviewer');
    expect(r.code).toBe(3);
    expect(h.keychain.items.has('profile:reviewer')).toBe(false);
    expect(await loadConfig(h.env)).toEqual(DEFAULT_CONFIG);
  });

  it('rejects invalid names without prompting', async () => {
    const h = await harness({ answers: ['tk_x'] });
    const r = await h.run('profile', 'add', 'Bad Name');
    expect(r.code).toBe(2);
    expect(h.prompts).toHaveLength(0);
  });

  it('rejects an empty token', async () => {
    const h = await harness({ answers: [''] });
    expect((await h.run('profile', 'add', 'reviewer')).code).toBe(2);
    expect(h.calls).toHaveLength(0);
  });
});

describe('profile list/default/remove', () => {
  const config = { ...DEFAULT_CONFIG, profiles: { me: { username: 'trung' }, reviewer: { username: 'bot-reviewer' } } };
  const secrets = { ...DEFAULT_SECRETS, 'profile:reviewer': 'tk_rev' };

  it('list shows names, usernames and the default, never tokens', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'list');
    expect(r.out).toEqual({
      items: [
        { name: 'me', username: 'trung', default: true },
        { name: 'reviewer', username: 'bot-reviewer', default: false },
      ],
    });
    expect(r.stdout).not.toContain('tk_');
  });

  it('default switches the default profile', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'default', 'reviewer');
    expect(r.out).toEqual({ default_profile: 'reviewer' });
    expect((await loadConfig(h.env)).default_profile).toBe('reviewer');
    expect((await h.run('profile', 'default', 'ghost')).code).toBe(3);
  });

  it('remove deletes the token and clears the default if needed', async () => {
    const h = await harness({ config, secrets });
    const r = await h.run('profile', 'remove', 'me');
    expect(r.out).toEqual({ removed: 'me' });
    expect(h.keychain.items.has('profile:me')).toBe(false);
    const saved = await loadConfig(h.env);
    expect(saved.profiles).toEqual({ reviewer: { username: 'bot-reviewer' } });
    expect(saved.default_profile).toBeUndefined();
    expect((await h.run('profile', 'remove', 'ghost')).code).toBe(3);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run test/setup.test.ts test/profile.test.ts`
Expected: FAIL (`unknown command 'setup'` / `'profile'`).

- [ ] **Step 4: Implement `src/commands/setup.ts`**

```ts
import type { Command } from 'commander';
import { VikunjaClient } from '../client';
import { ACCOUNT_CF_ID, ACCOUNT_CF_SECRET, loadConfig, normalizeUrl, saveConfig } from '../config';
import { print, type Deps } from '../context';
import { usageError } from '../errors';
import type { Obj } from '../output';

export function registerSetup(program: Command, deps: Deps): void {
  program
    .command('setup')
    .description('store the Vikunja URL and Cloudflare Access service token (run by a human)')
    .action(async () => {
      const cfg = await loadConfig(deps.env);
      const url = normalizeUrl(await deps.prompter.ask('Vikunja URL (e.g. https://vikunja.example.com): '));
      if (!/^https?:\/\/\S+$/.test(url)) throw usageError('invalid URL', 'expected http:// or https:// followed by the host');
      const cfClientId = await deps.prompter.ask('Cloudflare Access client ID: ');
      const cfClientSecret = await deps.prompter.ask('Cloudflare Access client secret: ', { hidden: true });
      if (!cfClientId || !cfClientSecret) throw usageError('client ID and secret are required');

      // Verify before storing so a typo never replaces working credentials.
      const client = new VikunjaClient({ connection: { url, cfClientId, cfClientSecret }, fetch: deps.fetch });
      const info = await client.request<Obj>('GET', '/info');

      await deps.keychain.set(ACCOUNT_CF_ID, cfClientId);
      await deps.keychain.set(ACCOUNT_CF_SECRET, cfClientSecret);
      await saveConfig(deps.env, { ...cfg, url });
      print(deps, { ok: true, url, vikunja_version: info?.version ?? null });
    });
}
```

- [ ] **Step 5: Implement `src/commands/profile.ts`**

```ts
import type { Command } from 'commander';
import { VikunjaClient } from '../client';
import { loadConfig, PROFILE_NAME, profileAccount, resolveConnection, saveConfig, type ConfigFile } from '../config';
import { print, type Deps } from '../context';
import { CliError, usageError } from '../errors';
import type { Obj } from '../output';

function notFound(name: string): CliError {
  return new CliError(3, `profile \`${name}\` not found`, { detail: 'run `vikunja profile list` to see configured profiles' });
}

export function registerProfile(program: Command, deps: Deps): void {
  const profile = program.command('profile').description('manage Vikunja identities (run by a human)');

  profile
    .command('add <name>')
    .description('store a Vikunja API token under a profile name (token read from a hidden prompt or stdin)')
    .action(async (name: string) => {
      if (!PROFILE_NAME.test(name)) {
        throw usageError(`invalid profile name: ${name}`, 'use lowercase letters, digits, - and _ (max 32 characters)');
      }
      const cfg = await loadConfig(deps.env);
      const connection = await resolveConnection(deps.env, deps.keychain, cfg);
      const token = await deps.prompter.ask(`Vikunja API token for ${name}: `, { hidden: true });
      if (!token) throw usageError('token is required');

      const client = new VikunjaClient({ connection, token, profile: name, fetch: deps.fetch });
      const user = await client.request<Obj>('GET', '/user');

      await deps.keychain.set(profileAccount(name), token);
      const defaultProfile = cfg.default_profile ?? name;
      await saveConfig(deps.env, {
        ...cfg,
        default_profile: defaultProfile,
        profiles: { ...cfg.profiles, [name]: { username: user.username } },
      });
      print(deps, { name, username: user.username, default: defaultProfile === name });
    });

  profile
    .command('list')
    .description('list profiles (never prints tokens)')
    .action(async () => {
      const cfg = await loadConfig(deps.env);
      const items = Object.entries(cfg.profiles)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, meta]) => ({ name, username: meta.username, default: cfg.default_profile === name }));
      print(deps, { items });
    });

  profile
    .command('default <name>')
    .description('set the profile used when neither --as nor VIKUNJA_PROFILE is given')
    .action(async (name: string) => {
      const cfg = await loadConfig(deps.env);
      if (!cfg.profiles[name]) throw notFound(name);
      await saveConfig(deps.env, { ...cfg, default_profile: name });
      print(deps, { default_profile: name });
    });

  profile
    .command('remove <name>')
    .description('delete a profile and its stored token')
    .action(async (name: string) => {
      const cfg = await loadConfig(deps.env);
      if (!cfg.profiles[name]) throw notFound(name);
      await deps.keychain.delete(profileAccount(name));
      const { [name]: _removed, ...profiles } = cfg.profiles;
      const next: ConfigFile = { ...cfg, profiles };
      if (next.default_profile === name) delete next.default_profile;
      await saveConfig(deps.env, next);
      print(deps, { removed: name });
    });
}
```

- [ ] **Step 6: Register both in `src/cli.ts`**

Add the imports next to the other command imports:
```ts
import { registerProfile } from './commands/profile';
import { registerSetup } from './commands/setup';
```
Add the calls directly after `registerComments(program, deps);`:
```ts
  registerSetup(program, deps);
  registerProfile(program, deps);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/setup.test.ts test/profile.test.ts`
Expected: 5 setup tests and 8 profile tests PASS.

- [ ] **Step 8: Implement `src/prompt.ts`**

No unit test: this needs a real terminal. Task 13 checks it by hand.

```ts
import { createInterface, type Interface } from 'node:readline';
import { Writable } from 'node:stream';
import type { Prompter } from './context';

export function terminalPrompter(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): Prompter {
  let piped: { rl: Interface; lines: AsyncIterator<string> } | undefined;

  return {
    async ask(question, options = {}) {
      if (!input.isTTY) {
        // Piped input (e.g. `pbpaste | vikunja profile add bot`): one line per question, no prompt text.
        if (!piped) {
          const rl = createInterface({ input, terminal: false });
          piped = { rl, lines: rl[Symbol.asyncIterator]() };
        }
        const next = await piped.lines.next();
        return next.done ? '' : next.value.trim();
      }

      let muted = false;
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          if (!muted) output.write(chunk);
          callback();
        },
      });
      const rl = createInterface({ input, output: sink, terminal: true });
      rl.on('SIGINT', () => {
        rl.close();
        output.write('\n');
        process.exit(130);
      });
      try {
        const answer = new Promise<string>((resolve) => rl.question(question, resolve));
        muted = Boolean(options.hidden); // question text is already written; hide what the user types
        const value = await answer;
        if (options.hidden) output.write('\n');
        return value.trim();
      } finally {
        rl.close();
      }
    },

    close() {
      piped?.rl.close();
    },
  };
}
```

- [ ] **Step 9: Implement `src/main.ts`**

`process.exitCode` is used instead of `process.exit()`. On macOS, stdout writes to a pipe are asynchronous, so exiting immediately could cut off large JSON output.

```ts
import { runCli } from './cli';
import { securityKeychain } from './keychain';
import { terminalPrompter } from './prompt';

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write(
    `${JSON.stringify({ error: { title: `Node.js 20 or newer is required (found ${process.versions.node})` } })}\n`,
  );
  process.exit(3);
}

runCli(process.argv.slice(2), {
  env: process.env,
  keychain: securityKeychain(),
  fetch: (url, init) => fetch(url, init),
  io: {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  },
  prompter: terminalPrompter(),
}).then((code) => {
  process.exitCode = code;
});
```

- [ ] **Step 10: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 11: Commit**

```bash
git add src/prompt.ts src/main.ts src/commands/setup.ts src/commands/profile.ts src/cli.ts test/setup.test.ts test/profile.test.ts
git commit -F- <<'EOF'
feat: add setup and profile commands and the entry point

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 10: Bundle into `plugin/bin/vikunja`

**Files:**
- Create: `scripts/build.mjs`, `plugin/package.json`
- Create (generated, committed): `plugin/bin/vikunja`
- Test: `test/bundle.test.ts`

**Interfaces:**
- Consumes: `src/main.ts` (Task 9) as the entry point.
- Produces: `scripts/build.mjs` exports `OUTFILE = 'plugin/bin/vikunja'` and `buildOptions` (esbuild `BuildOptions`). Running `npm run build` writes the executable.

Why `plugin/package.json` exists: the repo root `package.json` has `"type": "module"`, and Node treats an extensionless file inside a `"type": "module"` package as ESM. The bundle is CommonJS. `plugin/package.json` with `"type": "commonjs"` is the nearest `package.json` both in the repo and in the installed plugin copy, so Node loads the bundle as CommonJS in both places.

- [ ] **Step 1: Write the failing test `test/bundle.test.ts`**

```ts
import { build } from 'esbuild';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildOptions, OUTFILE } from '../scripts/build.mjs';

describe('bundle', () => {
  it('committed plugin/bin/vikunja matches the sources', async () => {
    const result = await build({ ...buildOptions, outfile: OUTFILE, write: false });
    const fresh = result.outputFiles![0].text;
    const committed = await readFile(OUTFILE, 'utf8');
    expect(committed === fresh, 'plugin/bin/vikunja is stale: run `npm run build` and commit it').toBe(true);
  }, 30_000);

  it('is executable and starts with a node shebang', async () => {
    expect((await stat(OUTFILE)).mode & 0o111).not.toBe(0);
    expect((await readFile(OUTFILE, 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/bundle.test.ts`
Expected: FAIL, cannot resolve `../scripts/build.mjs`.

- [ ] **Step 3: Create `scripts/build.mjs`**

```js
import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const OUTFILE = 'plugin/bin/vikunja';

/** @type {import('esbuild').BuildOptions} */
export const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build({ ...buildOptions, outfile: OUTFILE });
  await chmod(OUTFILE, 0o755);
}
```

- [ ] **Step 4: Create `plugin/package.json`**

```json
{
  "type": "commonjs"
}
```

- [ ] **Step 5: Build and run the tests**

Run: `npm run build && npx vitest run test/bundle.test.ts && npm run typecheck`
Expected: `plugin/bin/vikunja` is created; 2 bundle tests PASS; typecheck exits 0.

- [ ] **Step 6: Check the executable by hand**

Run:
```bash
./plugin/bin/vikunja --version
./plugin/bin/vikunja tasks list --help | head -5
XDG_CONFIG_HOME="$(mktemp -d)" ./plugin/bin/vikunja whoami; echo "exit=$?"
```
Expected:
- `0.1.0`
- Help text for `tasks list` showing `--project`, `--filter` and `--as`.
- One JSON line on stderr whose `error.title` is `no profile configured`, followed by `exit=3`. This reads the real Keychain, but the empty temp config means no profile is looked up.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 8: Commit with the executable bit**

```bash
git add scripts/build.mjs plugin/package.json plugin/bin/vikunja test/bundle.test.ts
git ls-files -s plugin/bin/vikunja
```
Expected: the mode column shows `100755`. If it shows `100644`, run `git update-index --chmod=+x plugin/bin/vikunja`.

```bash
git commit -F- <<'EOF'
build: bundle CLI into plugin/bin/vikunja

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

From here on, any change under `src/` must be followed by `npm run build`, committing `plugin/bin/vikunja` along with the source change. The bundle test enforces this.

### Task 11: Plugin packaging, skill and README

**Files:**
- Create: `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json`, `plugin/skills/vikunja/SKILL.md`, `README.md`
- Test: `test/packaging.test.ts`

**Interfaces:**
- Consumes: `VERSION` (`src/cli.ts`), `plugin/bin/vikunja` (Task 10).
- Produces: an installable marketplace `vikunja-cli` containing plugin `vikunja`.

- [ ] **Step 1: Write the failing test `test/packaging.test.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { VERSION } from '../src/cli';

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

it('package.json, plugin.json and the CLI share one version', async () => {
  expect((await readJson('package.json')).version).toBe(VERSION);
  expect((await readJson('plugin/.claude-plugin/plugin.json')).version).toBe(VERSION);
});

it('the marketplace lists the plugin from ./plugin', async () => {
  const marketplace = await readJson('.claude-plugin/marketplace.json');
  expect(marketplace.name).toBe('vikunja-cli');
  expect(marketplace.plugins).toEqual([expect.objectContaining({ name: 'vikunja', source: './plugin' })]);
});

it('the skill pre-approves only agent commands, never setup or profile', async () => {
  const skill = await readFile('plugin/skills/vikunja/SKILL.md', 'utf8');
  const line = skill.split('\n').find((l) => l.startsWith('allowed-tools:'));
  expect(line).toBe(
    'allowed-tools: Bash(vikunja whoami) Bash(vikunja whoami *) Bash(vikunja projects *) Bash(vikunja tasks *) Bash(vikunja labels *) Bash(vikunja comments *)',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/packaging.test.ts`
Expected: FAIL with ENOENT for `plugin/.claude-plugin/plugin.json`.

- [ ] **Step 3: Create `.claude-plugin/marketplace.json`**

```json
{
  "name": "vikunja-cli",
  "owner": { "name": "trung" },
  "plugins": [
    {
      "name": "vikunja",
      "source": "./plugin",
      "description": "Vikunja CLI for agents (API v2, Cloudflare Access, multi-profile)"
    }
  ]
}
```

- [ ] **Step 4: Create `plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "vikunja",
  "version": "0.1.0",
  "description": "Vikunja CLI for AI agents: projects, tasks, labels and comments over API v2 behind Cloudflare Access, with per-agent bot profiles.",
  "author": { "name": "trung" }
}
```

- [ ] **Step 5: Create `plugin/skills/vikunja/SKILL.md`**

````markdown
---
name: vikunja
description: Manage Vikunja projects, tasks, labels and comments with the `vikunja` CLI. Use when the user or your instructions mention Vikunja, todo tasks, task comments, or acting as a Vikunja bot profile.
allowed-tools: Bash(vikunja whoami) Bash(vikunja whoami *) Bash(vikunja projects *) Bash(vikunja tasks *) Bash(vikunja labels *) Bash(vikunja comments *)
---

# Vikunja CLI

`vikunja` talks to the user's self-hosted Vikunja. Every command prints one JSON document to stdout; errors print `{"error": {...}}` to stderr.

## Identity

- If your instructions name a Vikunja profile (for example "act as `reviewer`"), add `--as <profile>` at the **end** of every command: `vikunja tasks list --as reviewer`.
- Otherwise omit `--as`; the session's profile is used.
- Unsure who you are acting as? Run `vikunja whoami`.
- "profile is locked for this session" means this session is pinned to one profile: drop `--as`.
- Never run `vikunja setup` or `vikunja profile …`. Those are for the human.

## Commands

```bash
vikunja whoami

vikunja projects list [--archived] [--search "home"]
vikunja projects get 12
vikunja projects create --title "Website" [--description "Markdown"] [--parent 3]
vikunja projects update 12 [--title "New name"] [--description "Markdown"]
vikunja projects archive 12          # unarchive 12
vikunja projects delete 12 --yes     # deletes its tasks too

vikunja tasks list                                    # open tasks in all projects
vikunja tasks list --project 12 --sort due_date:asc --sort priority:desc
vikunja tasks list --filter "done = false && due_date < now+7d"
vikunja tasks list --include-done --search "invoice"
vikunja tasks get 345
vikunja tasks create --project 12 --title "Draft post" [--description "## Notes"] [--due 2026-09-30] [--priority 3]
vikunja tasks update 345 [--title …] [--description …] [--due 2026-10-01T09:00|none] [--priority 0-5]
vikunja tasks done 345               # undone 345
vikunja tasks delete 345 --yes

vikunja labels list [--search urgent]
vikunja labels create --title urgent [--color e11d48]
vikunja labels add 345 7             # task 345, label 7
vikunja labels remove 345 7
vikunja labels delete 7 --yes

vikunja comments list 345
vikunja comments add 345 --text "Reviewed. **Looks good.**"
```

- List commands accept `--page N`, `--per-page N` (default 50, max 1000) and `--all` (up to 5000 items; `"truncated": true` when cut off).
- Any API command accepts `--full` to print the complete API object instead of the trimmed one.
- `--due`: `YYYY-MM-DD` means 23:59:59 local time that day; ISO datetimes are accepted; `none` clears the date (update only).
- Priority: 0 unset, 1 low, 2 medium, 3 high, 4 urgent, 5 do now.
- `tasks update` changes only the fields you pass.

## Filters (`tasks list --filter`)

- Operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, combined with `&&` and `||`, with parentheses.
- Common fields: `done`, `priority`, `due_date`, `start_date`, `end_date`, `done_at`, `created`, `updated`, `labels`, `project`.
- Labels and projects are numeric IDs: `labels in 3, 7`, `project = 12`.
- Date math: `now`, `now+7d`, `now-1w`, `now/d` (start of day); units `s m h d w M y`.
- Passing `--filter` replaces the default "open tasks only", so add `done = false` yourself when needed.

## Output

- Lists: `{"items": [...], "page": 1, "per_page": 50, "total_pages": 2, "total": 71}`.
- Tasks: `id, title, done, project_id, due_date, priority, labels[{id,title}]`; `get`, `create` and `update` add `description, created, updated, done_at, created_by`.
- Unset dates are `null`. Descriptions and comments are Markdown.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | success | |
| 1 | API or network error | read `error.title`, `error.detail` and `error.errors`; fix the input or report it |
| 2 | bad arguments | fix the command (see `vikunja <command> --help`) |
| 3 | config or auth problem (Cloudflare, token, missing profile) | stop and tell the human; do not retry |

## Rules

- Look up IDs with `list` commands. Never guess an ID.
- Before creating a label, run `vikunja labels list --search "<title>"` and reuse an existing one.
- Only pass `--yes` when the user explicitly asked for that deletion.
- Quote arguments with spaces. Use single quotes around text containing `$` or backticks.
````

- [ ] **Step 6: Create `README.md`**

````markdown
# vikunja CLI

A JSON-speaking command-line tool that lets AI agents in Claude Code manage a self-hosted [Vikunja](https://vikunja.io) instance: projects, tasks, labels and comments. It uses Vikunja API v2, passes Cloudflare Access with a service token, and supports one Vikunja bot account per agent.

## Requirements

- macOS (secrets are stored in the login Keychain)
- Node.js 20 or newer on `PATH`
- Vikunja 2.4.0 or newer (API v2)
- A Cloudflare Access service token allowed by the Vikunja application's policy
- A Vikunja API token for each account the agents should use

## Install in Claude Code

```
/plugin marketplace add /Users/trung/Code/vikunja_cli
/plugin install vikunja@vikunja-cli
```

Once the repo is on GitHub, `/plugin marketplace add <owner>/<repo>` works the same way. Start a new Claude Code session after installing so the `vikunja` command and skill are available.

## One-time setup (in a regular terminal)

Run these yourself, from the repo directory, not through an agent:

```bash
./plugin/bin/vikunja setup                   # Vikunja URL, Cloudflare client ID and secret
./plugin/bin/vikunja profile add me          # your own API token; the first profile becomes the default
./plugin/bin/vikunja profile add reviewer    # a bot account's API token
./plugin/bin/vikunja profile list
```

Secrets typed at the prompts are hidden. You can also pipe a token: `pbpaste | ./plugin/bin/vikunja profile add reviewer`. Tokens live in the Keychain under the service `vikunja-cli`; `~/.config/vikunja-cli/config.json` holds only the URL and profile names.

## Choosing an identity per agent

A command uses the first identity it finds, in this order:

1. `--as <profile>` on the command
2. `VIKUNJA_PROFILE`
3. `VIKUNJA_API_TOKEN` (a raw token, for one-off runs)
4. the default profile (`vikunja profile default <name>`)

**Subagents.** In `.claude/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Reviews Vikunja tasks and leaves feedback comments.
---
You act as the Vikunja profile `reviewer`. Add `--as reviewer` to the end of every `vikunja` command.
```

**Separate sessions.** Pin a project's sessions to one bot in `.claude/settings.local.json`:

```json
{ "env": { "VIKUNJA_PROFILE": "planner", "VIKUNJA_PROFILE_LOCK": "1" } }
```

With `VIKUNJA_PROFILE_LOCK=1`, `--as` is rejected. This guards against mistakes; it is not a security boundary.

**Main session.** Uses the default profile.

## Environment overrides

`VIKUNJA_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` and `VIKUNJA_API_TOKEN` override stored values.

## Troubleshooting

| Error | Fix |
|---|---|
| `Cloudflare Access rejected the request` | Re-run `setup`; check the service token is in the Access policy and not expired |
| `Vikunja token for profile … is invalid or expired` | Create a new API token in Vikunja, then `profile add <name>` again |
| `profile … not found` / `no profile configured` | `profile list`, then `profile add` |
| `vikunja: command not found` in Claude Code | Check `/plugin` shows `vikunja` enabled, then start a new session |

## Development

```bash
npm install
npm test               # unit tests (fake HTTP and Keychain)
npm run typecheck
npm run build          # regenerate plugin/bin/vikunja; commit it with source changes
KEYCHAIN_IT=1 npx vitest run test/keychain.darwin.test.ts   # real Keychain round trip
SMOKE_PROFILE=<bot> npm run smoke                          # live test against your instance
```
````

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: all tests PASS, including the 3 packaging tests.

- [ ] **Step 8: Validate the manifests if the CLI supports it**

Run: `claude plugin --help`
If a `validate` subcommand is listed, run `claude plugin validate .` and fix any reported errors in the two JSON manifests. If there is no such subcommand, skip this step; Task 13 installs the plugin for real.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin plugin/.claude-plugin plugin/skills README.md test/packaging.test.ts
git commit -F- <<'EOF'
feat: package as Claude Code plugin with agent skill

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 12: Live smoke test

**Files:**
- Create: `vitest.smoke.config.ts`, `smoke/smoke.test.ts`
- Possibly modify: `src/commands/tasks.ts`, `test/tasks.test.ts`, `plugin/bin/vikunja` (only through the `--due none` fallback in Step 5)

**Interfaces:**
- Consumes: the built `plugin/bin/vikunja`; `VikunjaClient` (`src/client.ts`); `loadConfig`, `resolveConnection` (`src/config.ts`); `securityKeychain` (`src/keychain.ts`); `ZERO_DATE` (`src/output.ts`, fallback only).
- Produces: `npm run smoke`, which is skipped unless `SMOKE_PROFILE` is set.

**Precondition (human):** this task needs the user's real credentials. Before Step 3, stop and ask the user to run, in their own terminal from the repo directory:
```bash
./plugin/bin/vikunja setup
./plugin/bin/vikunja profile add <bot-profile>
./plugin/bin/vikunja whoami --as <bot-profile>
```
and to tell you the profile name once `whoami` prints their bot user. Do not ask them to paste tokens into the chat.

- [ ] **Step 1: Create `vitest.smoke.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['smoke/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 2: Create `smoke/smoke.test.ts`**

```ts
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
```

- [ ] **Step 3: Confirm the smoke test is skipped without a profile, then run it live**

Run: `npm run build && npm run smoke`
Expected: 3 tests skipped (no `SMOKE_PROFILE`).

Run: `SMOKE_PROFILE=<bot-profile> npm run smoke`
Expected: 3 tests PASS, and the temporary project and label are gone afterwards (`./plugin/bin/vikunja projects list --search vikunja-cli-smoke --as <bot-profile>` shows no items).

- [ ] **Step 4: If the OpenAPI test fails**

The server spec differs from what the CLI calls. Report the missing `[method, path]` pairs to the user together with the Vikunja server version (printed as `vikunja_version` by `vikunja setup`). Do not change endpoints without the user's approval, since the spec defines them.

- [ ] **Step 5: If only `expect(cleared.due_date).toBeNull()` fails**

v2 did not accept `null` for clearing the due date. Apply the fallback defined in the spec:

In `src/commands/tasks.ts`, add `ZERO_DATE` to the `../output` import:
```ts
import { shapeOne, trimTask, ZERO_DATE, type Obj } from '../output';
```
and in `taskFields` replace the `due` line with:
```ts
  if (opts.due !== undefined) fields.due_date = parseDue(opts.due, allowNoneDue) ?? ZERO_DATE;
```
In `test/tasks.test.ts`, test "update --due none clears the date…", change the expected body to:
```ts
body: { title: 'New', due_date: '0001-01-01T00:00:00Z' },
```
Then run `npm test && npm run build && SMOKE_PROFILE=<bot-profile> npm run smoke` and expect everything to PASS.

If any other assertion fails, stop and report the failing command and its stderr to the user.

- [ ] **Step 6: Commit**

```bash
git add vitest.smoke.config.ts smoke/smoke.test.ts src/commands/tasks.ts test/tasks.test.ts plugin/bin/vikunja
git commit -F- <<'EOF'
test: add live smoke test against Vikunja

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01U9XUjNLrnc8iKb7VTyEhyo
EOF
```

### Task 13: Plugin install check (with the user)

**Files:** none, unless a check fails and the user approves a fix.

This task confirms the assumptions the docs could not: that `bin/` lands on the Bash PATH with the committed executable bit and shebang, that `allowed-tools` pre-approves the right commands, and that prompts behave in a real terminal. Several steps must be done by the user; ask them and wait for their answers.

- [ ] **Step 1: User installs the plugin**

Ask the user to run in Claude Code:
```
/plugin marketplace add /Users/trung/Code/vikunja_cli
/plugin install vikunja@vikunja-cli
```
and then start a new Claude Code session.

- [ ] **Step 2: Check PATH, shebang and pre-approval (in the new session)**

Ask the user to send this prompt in the new session: "Run `vikunja whoami`, then `vikunja tasks list --per-page 3 --as <bot-profile>`, then `vikunja profile list`."
Expected:
- `whoami` and `tasks list` run **without** a permission prompt and print JSON.
- `profile list` **does** ask for permission.

If `vikunja` is not found, or the first two commands prompt, collect the exact error or prompt text and report it to the user. Don't change the packaging until they approve.

- [ ] **Step 3: Check prompts in a real terminal**

Ask the user to run, in a regular terminal from the repo directory:
```bash
./plugin/bin/vikunja profile add scratch       # type any text: input must not be echoed; then Enter
printf 'tk_invalid\n' | ./plugin/bin/vikunja profile add scratch; echo "exit=$?"
./plugin/bin/vikunja profile list
```
Expected:
- The first command hides the typed token and fails with exit 3 ("invalid or expired"), unless a real token was typed.
- The piped command prints the same JSON error, followed by `exit=3`.
- `profile list` does not show `scratch`.
If `scratch` was added with a real token, run `./plugin/bin/vikunja profile remove scratch`.

- [ ] **Step 4: Check identities end to end**

Ask the user to have a subagent whose instructions say "act as Vikunja profile `<bot-profile>`" comment on a test task. Then run `./plugin/bin/vikunja comments list <task-id>`. The newest comment's `author` must be the bot's username.

- [ ] **Step 5: Report**

Summarize each check as pass or fail for the user. If everything passed there is nothing to commit; the plan is complete.
