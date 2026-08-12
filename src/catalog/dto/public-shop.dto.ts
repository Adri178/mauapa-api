import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto, PageMetaDto } from '../../common/pagination.dto';

export class ShopSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'barbershop', description: 'Matches name or address' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

/**
 * What an anonymous visitor may see about a shop.
 *
 * Written as an explicit shape rather than passing a Prisma row through: the
 * row carries ownerId, and a directory that leaks which accounts own which
 * shops would undo half of the tenant isolation the rest of the API enforces.
 */
export class PublicShopDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Barbershop Pak Budi' })
  name!: string;

  @ApiProperty({ example: 'Jl. Melati No. 12, Bandung' })
  address!: string;

  @ApiProperty({ example: 'Asia/Jakarta' })
  timezone!: string;

  @ApiProperty({ description: "Judged by the shop's own wall clock, not the caller's" })
  openNow!: boolean;

  @ApiProperty({ example: 4, description: 'Active services only' })
  serviceCount!: number;

  @ApiProperty({ example: 2, description: 'Active staff only' })
  staffCount!: number;
}

export class PublicServiceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Potong Rambut Pria' })
  name!: string;

  @ApiProperty({ example: 30 })
  durationMinutes!: number;

  @ApiProperty({ example: 35000, description: 'Whole rupiah' })
  price!: number;
}

export class PublicStaffDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Andi' })
  name!: string;
}

export class PublicOpeningHoursDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday' })
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  open!: string;

  @ApiProperty({ example: '20:00' })
  close!: string;
}

/**
 * Everything a customer needs to reach the slot picker, in one request.
 *
 * Three round trips — shop, services, staff — would leave the page rendering in
 * stages, and the middle one is useless on its own.
 */
export class PublicShopDetailDto extends PublicShopDto {
  @ApiProperty({ type: [PublicServiceDto] })
  services!: PublicServiceDto[];

  @ApiProperty({ type: [PublicStaffDto] })
  staff!: PublicStaffDto[];

  @ApiProperty({ type: [PublicOpeningHoursDto], description: 'Days absent are closed days' })
  workingHours!: PublicOpeningHoursDto[];
}

export class PaginatedShopsDto {
  @ApiProperty({ type: [PublicShopDto] })
  data!: PublicShopDto[];

  @ApiProperty({ type: PageMetaDto })
  meta!: PageMetaDto;
}
