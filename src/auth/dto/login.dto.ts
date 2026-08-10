import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { normaliseEmail } from '../../common/transforms';

export class LoginDto {
  @ApiProperty({ example: 'owner@barbershop.id' })
  @IsEmail()
  @Transform(normaliseEmail)
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple' })
  @IsString()
  @MaxLength(128)
  password!: string;
}
