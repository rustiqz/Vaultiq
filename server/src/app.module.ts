import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { DeviceThrottlerGuard } from "./auth/device-throttler.guard.js";
import { DevicesController } from "./devices/devices.controller.js";
import { HealthController } from "./health/health.controller.js";
import { SyncController } from "./sync/sync.controller.js";
import { SyncService } from "./sync/sync.service.js";
import { VersionController } from "./version/version.controller.js";

@Module({
  imports: [
    // A global floor under every endpoint, keyed by device rather than IP
    // wherever a caller has proven a device identity (DeviceThrottlerGuard
    // below) — so one busy office behind one NAT doesn't rate-limit itself.
    // The auth routes tighten this further with their own decorators, and
    // stay IP-keyed unconditionally, since rate limiting is the only thing
    // throttling online guesses at the auth key there.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    DevicesController,
    SyncController,
    VersionController,
  ],
  providers: [AuthService, SyncService, { provide: APP_GUARD, useClass: DeviceThrottlerGuard }],
})
export class AppModule {}
