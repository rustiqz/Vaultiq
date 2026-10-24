// What happens to an error nothing else handled.
//
// Nest's default filter logs `exception.message` and the whole stack. For a
// database error that message can quote the values of the row that failed
// ("Key (...)=(...) already exists"), so it is never written. This logs the
// error's class, its SQLSTATE-style `code` when it has one, and the stack
// *frames* only (code locations, no message line), then answers with the same
// generic 500 as before.

import { type ArgumentsHost, Catch, HttpException, InternalServerErrorException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Response } from "express";
import { log } from "./logger.js";
import { requestId } from "./request-log.js";

@Catch()
export class UnhandledErrorFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    const res = host.switchToHttp().getResponse<Response>();
    const error = exception instanceof Error ? exception : undefined;
    const code = (error as { code?: unknown } | undefined)?.code;

    log.error("unhandled_error", {
      requestId: requestId(res),
      errorName: error?.name ?? typeof exception,
      errorCode: typeof code === "string" ? code : undefined,
      frames: error?.stack
        ?.split("\n")
        .filter((line) => line.trimStart().startsWith("at "))
        .slice(0, 8)
        .map((line) => line.trim())
        .join(" | "),
    });

    super.catch(new InternalServerErrorException(), host);
  }
}
