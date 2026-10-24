// One line per finished request: what was asked, how it went, how long it took.
//
// Logged from `res.on("finish")` on a plain middleware, not an interceptor,
// because interceptors run after guards -- a 401 from `DeviceGuard` or a 429
// from the throttler would never be seen, and those are exactly the lines
// worth having when a client says "sync stopped working".
//
// Deliberately absent: the URL (query strings can carry cursors and, in
// future, anything), headers, bodies, and the client's IP. The route is the
// *template* ("/devices/:id"), never the concrete path.

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AuthedRequest } from "../auth/device.guard.js";
import { log } from "./logger.js";

export function requestId(res: Response): string | undefined {
  const id: unknown = res.locals.requestId;
  return typeof id === "string" ? id : undefined;
}

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  const id = randomUUID();
  res.locals.requestId = id;
  // Echoed so a client reporting a failure can quote it and the line can be found.
  res.setHeader("X-Request-Id", id);

  res.on("finish", () => {
    const route: unknown = req.route && (req.route as { path?: unknown }).path;
    const template = typeof route === "string" ? `${req.baseUrl}${route}` : "unmatched";
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

    log[template === "/health" && status < 400 ? "debug" : level]("request", {
      requestId: id,
      method: req.method,
      route: template,
      status,
      ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      deviceId: (req as Partial<AuthedRequest>).caller?.deviceId,
    });
  });

  next();
}
