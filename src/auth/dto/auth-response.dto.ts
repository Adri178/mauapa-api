import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'owner@barbershop.id' })
  email!: string;

  @ApiProperty({ example: 'Budi Santoso' })
  name!: string;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'Which staff row this login is, for STAFF users. Null for everyone else. ' +
      'Without it a staff member cannot filter a shop’s day down to their own.',
  })
  staffId!: string | null;
}

export class AuthTokensDto {
  @ApiProperty({ description: 'Short-lived bearer token for the Authorization header' })
  accessToken!: string;

  @ApiProperty({ description: 'Long-lived token; rotated on every use' })
  refreshToken!: string;
}

export class AuthResultDto extends AuthTokensDto {
  @ApiProperty({ type: UserProfileDto })
  user!: UserProfileDto;
}
