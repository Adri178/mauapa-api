import { ApiProperty } from '@nestjs/swagger';
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
