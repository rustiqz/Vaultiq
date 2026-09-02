// The one connection pool.

import { Pool } from "pg";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

export const pool = new Pool({
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
pool.on("error", (error) => {
  console.error("database client error:", error.message);
});
