import { Controller, Get } from "@nestjs/common";
import { pool } from "../db/pool.js";

@Controller("health")
export class HealthController {
  /**
   * Whether the server can actually serve.
   *
   * Reaches the database rather than only reporting that the process is up:
   * a server that answers 200 while unable to read a vault is worse than one
   * that admits it is down.
   */
  @Get()
  async check(): Promise<{ status: string; database: string }> {
    try {
      await pool.query("select 1");
      return { status: "ok", database: "ok" };
    } catch {
      // No error detail. This endpoint is unauthenticated, and connection
      // strings and hostnames have a habit of ending up in them.
      return { status: "degraded", database: "unreachable" };
    }
  }
}
