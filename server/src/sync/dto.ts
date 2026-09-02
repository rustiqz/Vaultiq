// What a client may send. Nothing here describes what an item *is*.
//
// The fields below are exactly those already bound into each item's
// authentication tag. There is no field for a name, a username, a URL or
// notes, and the pipe rejects a request that carries one — so a client that
// started sending them would fail loudly rather than have the server quietly
// begin storing them.

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/** Roughly 48 KB of ciphertext once decoded — far beyond any login item. */
const MAX_CIPHERTEXT_B64 = 65_536;

/** Bounded so one request cannot ask the server to hold a vault in memory. */
const MAX_ITEMS_PER_PUSH = 200;

export class SyncItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  itemType!: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsInt()
  @Min(0)
  updatedAt!: number;

  @IsBoolean()
  deleted!: boolean;

  @IsInt()
  @Min(1)
  format!: number;

  @IsBase64()
  @MaxLength(MAX_CIPHERTEXT_B64)
  ciphertext!: string;

  @IsBase64()
  @MaxLength(256)
  nonce!: string;
}

export class PushDto {
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_PUSH)
  @ValidateNested({ each: true })
  @Type(() => SyncItemDto)
  items!: SyncItemDto[];
}
