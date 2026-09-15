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
