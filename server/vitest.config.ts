import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The server logs every audit event; tests would print hundreds of lines.
    // The logging tests set their own level.
    env: { LOG_LEVEL: "silent" },
    include: ["src/**/*.test.ts"],

    // One database, so one file at a time.
    //
    // These tests exercise real SQL — the single-account constraint, the row
    // locks, the sequence — which means they need a real Postgres rather than
    // a fake. They share it, and each clears the tables it works on, so
    // running two files at once has them delete each other's rows. That
    // failure only appears when the whole suite runs, which is the worst way
    // to find it.
    //
    // The alternative is a schema per file. Worth doing if the suite grows
    // slow; today it costs a couple of seconds.
    fileParallelism: false,
  },
});
