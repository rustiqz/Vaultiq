// Rate limiting keyed by device, not by IP -- except where there is no
// authenticated device to key on.
//
// A shared IP is normal, not suspicious, for an organisation: every employee
// sits behind the same corporate NAT, and the stock IP-keyed guard would let
// the busiest office rate-limit itself into what looks like a sync outage.
// Keying by device fixes that everywhere a caller has proven who they are.
//
// The identity has to be *proven*, not merely claimed. Guards run in this
// order -- this one, being global, runs before `DeviceGuard` on any route --
// so there is no already-verified `request.caller` to read here. A tracker
// that trusted a self-reported device id out of the `Authorization` header
// would let an attacker mint a fresh "device" per request and walk straight
// past the limit; that's why this guard runs the same credential check
// `DeviceGuard` does, and falls back to IP on anything that doesn't verify.
//
// The three bootstrap routes are an unconditional exception: nothing has
// registered yet when they run, so there is no credential to verify at all,
// and they stay on the plain IP-keyed default regardless of what a request's
// `Authorization` header claims.

import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from "@nestjs/throttler";
import type { Request } from "express";
import { AuthService } from "./auth.service.js";
import { IP_ONLY_PATHS, parseBearerCredential } from "./bearer-credential.js";

@Injectable()
export class DeviceThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: Request): Promise<string> {
    if (!IP_ONLY_PATHS.has(req.path)) {
      const parsed = parseBearerCredential(req.headers.authorization);
      const caller = parsed && (await this.auth.identify(parsed.deviceId, parsed.credential));
      if (caller) return `device:${caller.deviceId}`;
    }

    return await super.getTracker(req);
  }
}
