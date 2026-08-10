import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opt a route out of the globally applied JwtAuthGuard. Authentication is the
 * default; forgetting this decorator locks a route down rather than exposing it.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
