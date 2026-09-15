// The one connection pool.
//
// Constructed lazily, on first real use, rather than at import time. Several
// modules import something that transitively needs this file (AuthService,
// reached from any @Injectable() that takes it as a constructor dependency)
// without ever running a query — a unit test checking a decorator's metadata,
// say. A plain top-level `new Pool(...)` made DATABASE_URL a requirement just
// to import those, which it isn't; the error now happens at the first real
// query instead, wherever that turns out to be.

import { Pool } from "pg";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

let real: Pool | undefined;

function connect(): Pool {
  if (real !== undefined) return real;

  real = new Pool({
    connectionString: required("DATABASE_URL"),

    // A small ceiling: this serves one household, and an unbounded pool turns a
    // slow query into an outage rather than a slow request.
    max: 10,

    // Without these, a database that is down makes callers wait rather than
    // fail — the health check hung instead of reporting itself degraded, which
    // is the one thing a health check must never do.
    connectionTimeoutMillis: 3_000,
    statement_timeout: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // Not optional. A pooled client that is sitting idle when the database goes
  // away emits `error`, and an unhandled `error` on an EventEmitter takes the
  // whole process down — so losing the database for a moment would otherwise
  // kill the server rather than degrade it.
  //
  // Nothing is thrown from here. The pool discards the broken client and the
  // next request opens a fresh one; if the database is still gone, that request
  // fails on its own terms with its own timeout.
  real.on("error", (error) => {
    console.error("database client error:", error.message);
  });

  return real;
}

// A Proxy so every existing `pool.query(...)` / `pool.connect()` /
// `pool.end()` / `pool.on(...)` call site keeps working unchanged, forwarded
// to the lazily constructed Pool instead of built against a stand-in.
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop): unknown {
    const target = connect();
    const value: unknown = Reflect.get(target, prop);
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(target);
    }
    return value;
  },
});
