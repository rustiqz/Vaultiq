// Who is allowed to speak to this server.
//
// Only an enrolled, unrevoked device. There is no session and no expiry: a
// device holding the credential also holds a full local copy of the
// ciphertext, so timing it out protects nothing that revoking it does not.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService, type Caller } from "./auth.service.js";

/** A request that has been through the guard. */
export interface AuthedRequest extends Request {
  caller: Caller;
}

@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    // One message for a missing header, a malformed one, an unknown device,
    // a wrong credential and a revoked device. Distinguishing them would say
    // which device ids exist.
    const refuse = (): never => {
      throw new UnauthorizedException("Not authorised.");
    };

    if (!header?.startsWith("Bearer ")) refuse();

    const [deviceId, credential] = header!.slice("Bearer ".length).split(".", 2);
    if (!deviceId || !credential) refuse();

    const caller = await this.auth.identify(deviceId!, credential!);
    if (!caller) refuse();

    (request as AuthedRequest).caller = caller!;
    return true;
  }
}
