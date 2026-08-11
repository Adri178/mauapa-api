import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Counting a hit is three operations — increment, read the TTL, decide whether
 * the caller is now blocked — and they have to happen as one. Doing them as
 * separate round trips lets two requests each read a count of "limit - 1" and
 * both be allowed through, which is exactly the hole a rate limiter exists to
 * close. Redis runs this script atomically.
 *
 * KEYS[1] the hit counter, KEYS[2] the block marker.
 * ARGV: ttl, limit, blockDuration (all in milliseconds).
 *
 * Returns: totalHits, timeToExpire, isBlocked, timeToBlockExpire.
 */
const INCREMENT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  return { tonumber(redis.call('GET', hitsKey)) or limit, blockedFor, 1, blockedFor }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end

local timeToExpire = redis.call('PTTL', hitsKey)
if timeToExpire < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  timeToExpire = ttl
end

if hits > limit then
  redis.call('SET', blockKey, 1, 'PX', blockDuration)
  return { hits, timeToExpire, 1, blockDuration }
end

return { hits, timeToExpire, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
      // Counting requests must never become the reason a request fails.
      enableOfflineQueue: false,
      // Connect on the first counted request rather than at boot. When rate
      // limiting is switched off there is then no idle connection at all, and
      // nothing to wait on at shutdown.
      lazyConnect: true,
    });

    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis unavailable for rate limiting: ${error.message}`);
    });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitsKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitsKey}:blocked`;

    try {
      const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = (await this.redis.eval(
        INCREMENT,
        2,
        hitsKey,
        blockKey,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

      return {
        totalHits,
        // The guard works in seconds; Redis answers in milliseconds.
        timeToExpire: Math.ceil(timeToExpire / 1000),
        isBlocked: isBlocked === 1,
        timeToBlockExpire: Math.ceil(timeToBlockExpire / 1000),
      };
    } catch (error) {
      // Fail open. A rate limiter is a guard rail, not the lock on the door:
      // losing Redis should slow nobody down, and the endpoints it protects are
      // all authenticated or validated anyway.
      this.logger.error(
        `Rate limiting is degraded, allowing the request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return {
        totalHits: 0,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    // A lazy client that never connected has nothing to close, and quit() on it
    // would hang waiting for a connection that was never made.
    if (this.redis.status === 'end' || this.redis.status === 'wait') {
      this.redis.disconnect();
      return;
    }

    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
