import { ApiProperty } from '@nestjs/swagger';
import { IsJWT } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'The refresh token returned by login or a previous refresh' })
  @IsJWT()
  refreshToken!: string;
}
