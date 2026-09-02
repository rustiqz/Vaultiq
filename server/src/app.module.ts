import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { DevicesController } from "./devices/devices.controller.js";
import { HealthController } from "./health/health.controller.js";
import { SyncController } from "./sync/sync.controller.js";
import { SyncService } from "./sync/sync.service.js";

@Module({
  imports: [
    // A global floor under every endpoint. The auth routes tighten it further
    // with their own decorators — rate limiting is the only thing throttling
    // online guesses at the auth key, so it is not optional.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
  ],
  controllers: [HealthController, AuthController, DevicesController, SyncController],
  providers: [AuthService, SyncService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
