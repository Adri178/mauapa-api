import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TokenPair } from './auth.types';
import type { AuthResultDto, UserProfileDto } from './dto/auth-response.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const PROFILE_FIELDS = { id: true, email: true, name: true, role: true } as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResultDto> {
    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: { email: dto.email, name: dto.name, role: dto.role, passwordHash },
        select: PROFILE_FIELDS,
      });

      return { ...(await this.tokens.issuePair(user)), user };
    } catch (error) {
      // Checking first would leave a race between the check and the insert; the
      // unique index is the real guard, so translate its violation instead.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with that email already exists');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResultDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { ...PROFILE_FIELDS, passwordHash: true },
    });

    const valid = user
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : await this.passwords.verifyDummy(dto.password);

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { passwordHash: _discard, ...profile } = user;
    return { ...(await this.tokens.issuePair(profile)), user: profile };
  }

  refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  async profile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_FIELDS,
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return user;
  }
}
