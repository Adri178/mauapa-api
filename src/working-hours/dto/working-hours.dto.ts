import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Matches, Max, Min, ValidateNested } from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WorkingHoursEntryDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00', pattern: HH_MM.source })
  @Matches(HH_MM, { message: 'open must be HH:mm in 24-hour form' })
  open!: string;

  @ApiProperty({ example: '17:00', pattern: HH_MM.source })
  @Matches(HH_MM, { message: 'close must be HH:mm in 24-hour form' })
  close!: string;
}

/**
 * The whole week is replaced in one call. Owners think in terms of "these are
 * my opening hours", not individual row edits, and a wholesale replace removes
 * any chance of a half-applied schedule.
 */
export class SetWorkingHoursDto {
  @ApiProperty({ type: [WorkingHoursEntryDto], description: 'Omitted days are closed days' })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkingHoursEntryDto)
  hours!: WorkingHoursEntryDto[];
}

export class WorkingHoursResponseDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  open!: string;

  @ApiProperty({ example: '17:00' })
  close!: string;
}
