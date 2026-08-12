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

      // A brand-new account is never already a staff member: staff rows are
      // created by an owner, and that path makes the user, not this one.
      return { ...(await this.tokens.issuePair(user)), user: { ...user, staffId: null } };
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
      select: {
        ...PROFILE_FIELDS,
        passwordHash: true,
        // Resolved at login so a staff member lands on their own schedule
        // without a second round trip to find out who they are.
        staffProfile: { select: { id: true } },
      },
    });

    const valid = user
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : await this.passwords.verifyDummy(dto.password);

    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const { passwordHash: _discard, staffProfile, ...profile } = user;
    const withStaff = { ...profile, staffId: staffProfile?.id ?? null };

    return { ...(await this.tokens.issuePair(profile)), user: withStaff };
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
      select: { ...PROFILE_FIELDS, staffProfile: { select: { id: true } } },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const { staffProfile, ...profile } = user;

    return { ...profile, staffId: staffProfile?.id ?? null };
  }
}
