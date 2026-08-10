import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { normaliseEmail, trim } from '../../common/transforms';

/**
 * STAFF is deliberately absent: anyone could otherwise self-register into a role
 * that carries shop privileges. Owners create their staff from inside a shop
 * (Phase 2).
 */
export const SELF_SERVICE_ROLES = [Role.OWNER, Role.CUSTOMER] as const;
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number];

export class RegisterDto {
  @ApiProperty({ example: 'owner@barbershop.id' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(normaliseEmail)
  email!: string;

  @ApiProperty({ example: 'Budi Santoso', maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128)
  password!: string;

  @ApiProperty({ enum: SELF_SERVICE_ROLES, example: Role.CUSTOMER })
  @IsIn(SELF_SERVICE_ROLES, { message: 'role must be either OWNER or CUSTOMER' })
  role!: SelfServiceRole;
}
