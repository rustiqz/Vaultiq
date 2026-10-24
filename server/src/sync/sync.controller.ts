import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { DeviceGuard, type AuthedRequest } from "../auth/device.guard.js";
import { log } from "../logging/logger.js";
import { PushDto } from "./dto.js";
import { SyncService, type PullResult, type PushResult } from "./sync.service.js";

@Controller("sync")
@UseGuards(DeviceGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Everything written after `since`.
   *
   * The cursor is a bare integer as a string, because it comes from a bigint
   * sequence that need not fit a JavaScript number forever.
   */
  @Get()
  async pull(@Req() request: AuthedRequest, @Query("since") since?: string): Promise<PullResult> {
    const from = since !== undefined && /^\d+$/.test(since) ? since : "0";
    return await this.sync.pull(request.caller, from);
  }

  @Post()
  async push(@Req() request: AuthedRequest, @Body() body: PushDto): Promise<PushResult> {
    const result = await this.sync.push(request.caller, body.items);
    // Counts only. Conflicts are the line to look for when two devices disagree.
    log.info("sync_push", {
      deviceId: request.caller.deviceId,
      items: body.items.length,
      accepted: result.accepted.length,
      conflicts: result.conflicts.length,
    });
    return result;
  }
}
