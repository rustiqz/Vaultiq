import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Express } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { ensureBootstrapToken } from "./auth/bootstrap-token.js";
import { migrate } from "./db/migrate.js";
import { VERSION } from "./version.js";

async function bootstrap(): Promise<void> {
  // Before the first request rather than as a deploy step: the server and its
  // schema then cannot disagree, whatever order the containers came up in.
  await migrate();

  // Registration is always invite-only, so a server with no accounts yet
  // needs a live token to become usable at all.
  await ensureBootstrapToken();

  const app = await NestFactory.create(AppModule, {
    // Nothing here serves a browser page, so CORS stays off. The extension
    // talks to it from a background context, which is not subject to it.
    cors: false,
  });

  app.use(helmet());

  // Caddy is the only thing this server ever hears from directly (the
  // compose network exposes nothing else) — trusting exactly one hop means
  // `req.ip` is the real caller's address from Caddy's X-Forwarded-For,
  // not Caddy's own container IP. Without this, every request looked like
  // it came from the same place, which made IP-keyed rate limiting and the
  // audit log's source_ip on refused attempts (see SECURITY.md) both
  // useless behind the real deployment's reverse proxy — caught only while
  // building the audit log, not something a local, proxy-free dev server
  // would ever surface.
  (app.getHttpAdapter().getInstance() as Express).set("trust proxy", 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // A request carrying fields the endpoint does not declare is rejected
      // rather than trimmed. Silently dropping them hides a client and server
      // that disagree about the protocol.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  // Logged at boot so a running container can be identified from its logs
  // alone, without a request and without shelling in.
  console.log(`vaultiq-server ${VERSION} listening on ${String(port)}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
