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
    ['2026-09-20T09:30:00.123Z', '2026-09-20T09:30:00.123Z'],
    ['2026-09-20T09:30Z', '2026-09-20T09:30:00Z'],
    ['2026-09-20T09:30+07:00', '2026-09-20T09:30:00+07:00'],
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

  it.each([
    'tomorrow',
    '2026-02-30',
    '2026-13-01',
    '2026-09-20T25:00',
    '20-09-2026',
    '2026-02-30T09:30:00Z',
    '2026-09-20T24:00:00+07:00',
    '2026-09-20T09:60:00Z',
    '2026-09-20T09:30:00+25:00',
  ])('rejects %s with exit 2', (input) => {
    expect(thrown(() => parseDue(input, true))).toMatchObject({ exitCode: 2, info: { title: 'invalid --due value' } });
  });
});
