// A migration runner in eighty lines rather than an ORM.
//
// The schema here is five tables of blobs and credentials; an ORM would add a
// layer to audit for no benefit, and the one table that matters is written
// and read as raw bytes either way.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

async function applied(): Promise<Map<string, string>> {
  await pool.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await pool.query<{ name: string; checksum: string }>(
    "select name, checksum from schema_migrations",
  );
  return new Map(rows.map((row) => [row.name, row.checksum]));
}

export async function migrate(): Promise<void> {
  const done = await applied();
  const files = (await readdir(MIGRATIONS)).filter((name) => name.endsWith(".sql")).sort();

  for (const name of files) {
    const sql = await readFile(join(MIGRATIONS, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = done.get(name);

    if (previous !== undefined) {
      // An edited migration means the database and the repository disagree
      // about what was run. That is worth stopping for, not warning about.
      if (previous !== checksum) {
        throw new Error(`Migration ${name} has changed since it was applied.`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
        name,
        checksum,
      ]);
      await client.query("commit");
      console.log(`applied ${name}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

// Run directly with `pnpm migrate`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => pool.end())
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
