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
