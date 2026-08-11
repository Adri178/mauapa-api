import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { normaliseEmail, trim } from '../../common/transforms';

/**
 * A staff member is first a schedulable resource and only optionally a login.
 * Supplying an email provisions a new STAFF account owned by this shop.
 *
 * Deliberately absent: any way to point at an existing user id. Accepting one
 * would let an owner attach a stranger's account — exactly the "never trust an
 * id from the client" rule this project is built around.
 */
export class CreateStaffDto {
  @ApiProperty({ example: 'Andi', maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  @Transform(trim)
  name!: string;

  @ApiPropertyOptional({
    example: 'andi@barbershop.id',
    description: 'Provisions a STAFF login for this person. Requires password.',
  })
  @IsOptional()
  @IsEmail()
  @Transform(normaliseEmail)
  email?: string;

  @ApiPropertyOptional({ minLength: 8, maxLength: 128, description: 'Required when email is set' })
  @ValidateIf((dto: CreateStaffDto) => dto.email !== undefined)
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
