import { usageError } from './errors';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const OFFSET_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

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

// Validates offset datetime components (Z or ±HH:MM) are in valid ranges and dates don't roll over.
function isValidOffsetDatetime(match: RegExpExecArray): boolean {
  const [, yStr, moStr, dStr, hStr, miStr, sStr, isZ, sign, ohStr, omStr] = match;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  const h = Number(hStr);
  const mi = Number(miStr);
  const s = sStr ? Number(sStr) : 0;
  const oh = Number(ohStr || 0);
  const om = Number(omStr || 0);

  // Validate component ranges
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59 || oh > 23 || om > 59) return false;

  // Validate day is valid for the month (using UTC date check to avoid DST issues)
  const checkDate = new Date(Date.UTC(y, mo - 1, d));
  return checkDate.getUTCFullYear() === y && checkDate.getUTCMonth() === mo - 1 && checkDate.getUTCDate() === d;
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
  const offset = OFFSET_DATETIME.exec(input);
  if (offset && isValidOffsetDatetime(offset)) return input;
  throw invalid(input);
}
