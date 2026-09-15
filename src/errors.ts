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
