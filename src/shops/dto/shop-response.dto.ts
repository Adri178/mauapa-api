import { ApiProperty } from '@nestjs/swagger';

export class ShopResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ example: 'Barbershop Pak Budi' })
  name!: string;

  @ApiProperty({ example: 'Jl. Melati No. 12, Bandung' })
  address!: string;

  @ApiProperty({ example: 'Asia/Jakarta' })
  timezone!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
