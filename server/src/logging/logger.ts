// The server's one logger: a JSON object per line on stdout/stderr, for
// `docker compose logs` and anything that greps them.
//
// What keeps secrets out is the *shape* of the API, not a filter: a field is a
// string, number or boolean that the caller chose to name, never a whole
// request, body, header or error object. Nothing here can serialise a thing
// it was not handed field by field. Call sites pass identifiers (device id,
// route template, status), never values a client supplied.

import type { LoggerService } from "@nestjs/common";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | undefined>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "silent") return Infinity;
  return raw && raw in ORDER ? ORDER[raw as LogLevel] : ORDER.info;
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (ORDER[level] < threshold()) return;
  // Reserved keys last, so a field can never overwrite them.
  const line = JSON.stringify({ ...fields, time: new Date().toISOString(), level, event });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: LogFields): void => write("debug", event, fields),
  info: (event: string, fields?: LogFields): void => write("info", event, fields),
  warn: (event: string, fields?: LogFields): void => write("warn", event, fields),
  error: (event: string, fields?: LogFields): void => write("error", event, fields),
};

/**
 * What Nest's own internals log through. Their messages are free text and
 * `error` ones carry whatever an exception said, so none of it is written:
 * startup chatter is kept at debug, and errors are reduced to a bare marker
 * (the exception filter logs the real, scrubbed detail itself).
 */
export class NestLogger implements LoggerService {
  log(_message: unknown, context?: string): void {
    log.debug("nest", { context });
  }
  debug(_message: unknown, context?: string): void {
    log.debug("nest", { context });
  }
  verbose(_message: unknown, context?: string): void {
    log.debug("nest", { context });
  }
  warn(_message: unknown, context?: string): void {
    log.warn("nest_warning", { context });
  }
  error(_message: unknown, _stack?: unknown, context?: string): void {
    log.error("nest_error", { context });
  }
}
