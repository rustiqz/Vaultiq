// Request shapes.
//
// The global pipe rejects anything carrying a field not declared here, so a
// client and server that disagree about the protocol fail loudly rather than
// having the difference silently trimmed away.

import { Type } from "class-transformer";
import {
  IsBase64,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class VaultBootstrapDto {
  @IsBase64()
  saltB64!: string;

  // Floors, not preferences: a vault written with accidentally weak costs
  // would be weak forever, and the server is the last place to notice.
  @IsInt()
  @Min(19 * 1024)
  memoryKib!: number;

  @IsInt()
  @Min(2)
  iterations!: number;

  @IsInt()
  @Min(1)
  parallelism!: number;

  @IsObject()
  wrappedVaultKey!: Record<string, unknown>;
}

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  authKey!: string;

  @ValidateNested()
  @Type(() => VaultBootstrapDto)
  vault!: VaultBootstrapDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  deviceName!: string;
}

export class EnrollmentParamsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}

export class EnrollDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  authKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  deviceName!: string;
}
