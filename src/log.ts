/**
 * Structured JSON logs on stderr (stdout stays free for CLI output). Every
 * line carries the run id so GitHub Actions logs can be grepped per run.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

let runId = 'local';

export function setRunId(id: string): void {
  runId = id;
}

function emit(level: Level, event: string, data: Record<string, unknown> = {}): void {
  if (level === 'debug' && !process.env.PIPELINE_DEBUG) return;
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), level, run: runId, event, ...data })}\n`,
  );
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => emit('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data),
};
