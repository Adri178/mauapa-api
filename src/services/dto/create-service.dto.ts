import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { trim } from '../../common/transforms';

export class CreateServiceDto {
  @ApiProperty({ example: 'Potong Rambut Pria', maxLength: 120 })
  @IsString()
  @MaxLength(120)
  @Transform(trim)
  name!: string;

  @ApiProperty({ example: 30, minimum: 5, maximum: 480, description: 'Minutes' })
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes!: number;

  @ApiProperty({ example: 35000, minimum: 0, description: 'Whole rupiah' })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
