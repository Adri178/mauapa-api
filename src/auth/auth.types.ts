import type { Role } from '@prisma/client';

/** Shape attached to `request.user` once the JWT strategy has validated a token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

/** Claims carried inside an access token. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

/** Claims carried inside a refresh token. `jti` ties it to a database row. */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
