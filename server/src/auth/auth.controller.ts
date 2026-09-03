import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  AuthService,
  type DeviceCredential,
  type KdfParams,
  type VaultBootstrap,
} from "./auth.service.js";
import { DeviceGuard, type AuthedRequest } from "./device.guard.js";
import { ChangeMasterPasswordDto, EnrollDto, EnrollmentParamsDto, RegisterDto } from "./dto.js";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Creates the one account. Refused once one exists.
   *
   * Throttled hard: it should be called exactly once in this server's life,
   * so anything more than a trickle is someone else finding the domain.
   */
  @Post("auth/register")
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async register(@Body() body: RegisterDto): Promise<DeviceCredential> {
    return await this.auth.register({
      authKey: body.authKey,
      vault: body.vault,
      deviceName: body.deviceName,
    });
  }

  /**
   * The salt and costs an enrolling device needs to derive its auth key.
   *
   * POST rather than GET because the token travels in the body: a query
   * string ends up in proxy logs and browser history, and this one is a
   * bearer secret for the next fifteen minutes.
   *
   * Throttled like `enroll`, since it takes the same token and is the
   * cheaper of the two to hammer.
   */
  @Post("auth/enrollment-params")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async enrollmentParams(@Body() body: EnrollmentParamsDto): Promise<KdfParams> {
    return await this.auth.enrollmentParams(body.token);
  }

  /**
   * Adds a device, given a token from a trusted one and the auth key.
   *
   * Throttled because the auth key is checked here: this is the only endpoint
   * where guessing gets an attacker anywhere, and the limit is what makes
   * that guessing pointless.
   */
  @Post("auth/enroll")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async enroll(@Body() body: EnrollDto): Promise<DeviceCredential> {
    return await this.auth.enroll({
      token: body.token,
      authKey: body.authKey,
      deviceName: body.deviceName,
    });
  }

  /** What a device needs to rebuild its keys from the master password. */
  @Get("vault")
  @UseGuards(DeviceGuard)
  async vault(@Req() request: AuthedRequest): Promise<VaultBootstrap> {
    return await this.auth.vaultBootstrap(request.caller);
  }

  /**
   * Re-wraps the vault under a new master password.
   *
   * Throttled like the other routes that take an auth key: this one accepts a
   * guess at the current password, and rate limiting is the only thing
   * standing between the endpoint and an online search for it.
   */
  @Post("vault/master-password")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(DeviceGuard)
  async changeMasterPassword(
    @Req() request: AuthedRequest,
    @Body() body: ChangeMasterPasswordDto,
  ): Promise<{ changed: true }> {
    await this.auth.changeMasterPassword(request.caller, {
      currentAuthKey: body.currentAuthKey,
      newAuthKey: body.newAuthKey,
      vault: body.vault,
    });
    return { changed: true };
  }
}
