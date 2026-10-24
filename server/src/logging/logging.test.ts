// The point of these tests is the negative: a request carrying secrets in
// every place a request can carry them must leave none of them in the output.

import { EventEmitter } from "node:events";
import type { ArgumentsHost } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnhandledErrorFilter } from "./exception.filter.js";
import { log } from "./logger.js";
import { requestLog } from "./request-log.js";

// Test-only values, obviously fake.
const SECRET = "FAKE-SECRET-do-not-use";

let out: string[];

beforeEach(() => {
  process.env.LOG_LEVEL = "info";
  out = [];
  const capture = (chunk: string | Uint8Array): boolean => {
    out.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, "write").mockImplementation(capture);
  vi.spyOn(process.stderr, "write").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.LOG_LEVEL = "silent";
});

function fakeResponse(status: number): Response {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  res.statusCode = status;
  res.locals = {};
  res.setHeader = vi.fn();
  return res as unknown as Response;
}

describe("logger", () => {
  it("writes one JSON object per line and honours LOG_LEVEL", () => {
    log.debug("hidden");
    log.info("shown", { n: 1 });
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ level: "info", event: "shown", n: 1 });

    process.env.LOG_LEVEL = "error";
    log.info("also hidden");
    expect(out).toHaveLength(1);
  });

  it("does not let a field overwrite the reserved keys", () => {
    log.info("real", { event: "forged", level: "debug" });
    expect(JSON.parse(out[0]!)).toMatchObject({ event: "real", level: "info" });
  });
});

describe("request log", () => {
  it("logs method, route template, status and device, and nothing the client sent", () => {
    const req = {
      method: "POST",
      originalUrl: `/sync?token=${SECRET}`,
      url: `/sync?token=${SECRET}`,
      baseUrl: "",
      route: { path: "/sync" },
      headers: { authorization: `Bearer dev-1.${SECRET}` },
      body: { items: [{ ciphertext: SECRET }] },
      ip: "203.0.113.9",
      caller: { userId: "u", vaultId: "v", deviceId: "dev-1" },
    } as unknown as Request;
    const res = fakeResponse(200);

    requestLog(req, res, (() => undefined) as NextFunction);
    res.emit("finish");

    const text = out.join("");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("203.0.113.9");
    expect(JSON.parse(text)).toMatchObject({
      event: "request",
      method: "POST",
      route: "/sync",
      status: 200,
      deviceId: "dev-1",
    });
  });

  it("logs a refused request, which no interceptor would see", () => {
    const req = { method: "GET", baseUrl: "", route: { path: "/sync" }, headers: {} } as unknown as Request;
    const res = fakeResponse(401);
    requestLog(req, res, (() => undefined) as NextFunction);
    res.emit("finish");
    expect(JSON.parse(out.join(""))).toMatchObject({ level: "warn", status: 401 });
  });
});

describe("unhandled error filter", () => {
  it("logs the error class and code but never its message", () => {
    const error = Object.assign(new Error(`Key (email)=(${SECRET}) already exists`), {
      name: "DatabaseError",
      code: "23505",
    });
    const res = fakeResponse(500);
    res.locals.requestId = "req-1";
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
    } as unknown as ArgumentsHost;

    // The base filter would write the generic 500; only the logging is under test.
    const base = Object.getPrototypeOf(UnhandledErrorFilter.prototype) as { catch: unknown };
    const spy = vi.spyOn(base as { catch: () => void }, "catch").mockImplementation(() => undefined);

    new UnhandledErrorFilter().catch(error, host);

    const text = out.join("");
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toMatchObject({
      event: "unhandled_error",
      requestId: "req-1",
      errorName: "DatabaseError",
      errorCode: "23505",
    });
    expect(spy).toHaveBeenCalledOnce();
  });
});
