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
