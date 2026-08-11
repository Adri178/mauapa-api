import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
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
/** Long enough for a container start, short enough not to delay boot. */
const CONNECT_TIMEOUT_MS = 3000;

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
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.getOrThrow<boolean>('THROTTLE_ENABLED');
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
      // Counting requests must never become the reason a request fails.
      enableOfflineQueue: false,
      // Connecting is deferred to onModuleInit so that switching rate limiting
      // off opens no connection at all.
      lazyConnect: true,
    });

    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis unavailable for rate limiting: ${error.message}`);
    });
  }

  /**
   * Opens the connection before any request arrives.
   *
   * A lazy client left to connect on its first command does not work here:
   * `enableOfflineQueue: false` rejects anything issued before the socket is
   * writable, so the first request after every boot would go uncounted. Found
   * by running the built image, not by the tests — they only assert that the
   * limit eventually bites.
   */
  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Rate limiting is disabled; no Redis connection opened');
      return;
    }

    try {
      // Idempotent: the hook can fire more than once, and ioredis throws rather
      // than no-ops if connect() is called on a client already on its way up.
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      } else if (this.redis.status !== 'ready') {
        await this.whenReady(CONNECT_TIMEOUT_MS);
      }
    } catch (error) {
      // Fail open, and say so loudly enough to be noticed in a deploy log.
      this.logger.error(
        `Could not connect to Redis; rate limiting will be degraded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Resolves once the client reports ready, or rejects on timeout. */
  private whenReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.redis.status === 'ready') {
        resolve();
        return;
      }

      const done = (settle: () => void) => () => {
        clearTimeout(timer);
        this.redis.off('ready', onReady);
        settle();
      };
      const timer = setTimeout(
        () => done(() => reject(new Error('timed out waiting for Redis')))(),
        timeoutMs,
      );
      const onReady = () => done(resolve)();

      this.redis.once('ready', onReady);
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
