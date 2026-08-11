import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
/** A ceiling, so one request cannot ask the database for an entire table. */
export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export class PageMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: DEFAULT_PAGE_SIZE })
  limit!: number;

  @ApiProperty({ example: 137, description: 'Rows matching the filter, ignoring pagination' })
  total!: number;

  @ApiProperty({ example: 7 })
  totalPages!: number;

  @ApiProperty()
  hasNextPage!: boolean;
}

export class PageDto<T> {
  data!: T[];
  meta!: PageMetaDto;
}

export function paginate<T>(data: T[], total: number, query: PaginationQueryDto): PageDto<T> {
  const totalPages = Math.ceil(total / query.limit);

  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
    },
  };
}
