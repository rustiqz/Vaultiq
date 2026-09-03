// Which build is answering.
//
// Behind the device guard, deliberately. `/health` is unauthenticated so that
// a container runtime can reach it, and an exact build number there would
// tell anyone who found the domain which advisories apply to it. An enrolled
// device already holds the whole ciphertext; the version tells it nothing it
// has not earned.

import { Controller, Get, UseGuards } from "@nestjs/common";
import { DeviceGuard } from "../auth/device.guard.js";
import { VERSION } from "../version.js";

@Controller("version")
@UseGuards(DeviceGuard)
export class VersionController {
  @Get()
  read(): { version: string } {
    return { version: VERSION };
  }
}
