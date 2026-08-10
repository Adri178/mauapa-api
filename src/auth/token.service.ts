import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { Role, User } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, RefreshTokenPayload, TokenPair } from './auth.types';

/** Refresh tokens are looked up by hash, so a stolen database dump is not enough to log in. */
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** jsonwebtoken types `expiresIn` as a narrow template literal; env validation
 * already guarantees the `ms` format, so widen the validated string to it. */
type ExpiresIn = NonNullable<JwtSignOptions['expiresIn']>;

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async issuePair(user: Pick<User, 'id' | 'email' | 'role'>): Promise<TokenPair> {
    const accessToken = await this.signAccessToken(user.id, user.email, user.role);
    const refreshToken = await this.issueRefreshToken(user.id);
    return { accessToken, refreshToken };
  }

  /**
   * Verifies a refresh token and rotates it: the presented token is revoked and
   * a fresh pair issued. Reusing an already-revoked token revokes every token
   * for that user — the standard response to a suspected token theft.
   */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (!stored || stored.id !== payload.jti) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token already used; all sessions revoked');
    }

    if (stored.expiresAt <= new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issuePair(stored.user);
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private signAccessToken(sub: string, email: string, role: Role): Promise<string> {
    const payload: AccessTokenPayload = { sub, email, role };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_ACCESS_TTL') as ExpiresIn,
    });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    // The row id doubles as the token's jti, so a token can be traced to exactly
    // one row and cannot be swapped onto another.
    const jti = randomUUID();
    const token = await this.jwt.signAsync({ sub: userId, jti } satisfies RefreshTokenPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.getOrThrow<string>('JWT_REFRESH_TTL') as ExpiresIn,
    });

    const decoded = this.jwt.decode<{ exp: number }>(token);
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(decoded.exp * 1000),
      },
    });

    return token;
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
