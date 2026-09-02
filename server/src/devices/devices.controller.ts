import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "../auth/auth.service.js";
import { DeviceGuard, type AuthedRequest } from "../auth/device.guard.js";

@Controller("devices")
@UseGuards(DeviceGuard)
export class DevicesController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  async list(@Req() request: AuthedRequest): Promise<unknown> {
    return await this.auth.listDevices(request.caller);
  }

  /** A token for a new device to present. Only a trusted device can mint one. */
  @Post("enrollment-token")
  async token(@Req() request: AuthedRequest): Promise<{ token: string; expiresAt: string }> {
    return await this.auth.createEnrollmentToken(request.caller);
  }

  @Delete(":id")
  async revoke(
    @Req() request: AuthedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<{ revoked: true }> {
    await this.auth.revokeDevice(request.caller, id);
    return { revoked: true };
  }
}
