import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsTimeZone, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/transforms';

export class CreateShopDto {
  @ApiProperty({ example: 'Barbershop Pak Budi', maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 'Jl. Melati No. 12, Bandung', maxLength: 255 })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  @Transform(trim)
  address!: string;

  @ApiPropertyOptional({
    example: 'Asia/Jakarta',
    default: 'Asia/Jakarta',
    description: 'IANA time zone; opening hours are interpreted in it',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
