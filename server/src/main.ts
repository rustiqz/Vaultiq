import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { migrate } from "./db/migrate.js";
import { VERSION } from "./version.js";

async function bootstrap(): Promise<void> {
  // Before the first request rather than as a deploy step: the server and its
  // schema then cannot disagree, whatever order the containers came up in.
  await migrate();

  const app = await NestFactory.create(AppModule, {
    // Nothing here serves a browser page, so CORS stays off. The extension
    // talks to it from a background context, which is not subject to it.
    cors: false,
  });

  app.use(helmet());

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
