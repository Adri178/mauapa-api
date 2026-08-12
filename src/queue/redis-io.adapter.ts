import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Puts Socket.IO's broadcasts on Redis pub/sub.
 *
 * Without this, `server.to(room).emit(...)` reaches only the clients connected
 * to *this* process. The moment the API runs behind more than one instance —
 * which is the point of deploying it — a customer watching the queue on one
 * instance would never hear about a status change handled by another. The
 * feature would look fine in development and be quietly broken in production.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect(redisUrl: string): Promise<void> {
    const publisher = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
    const subscriber = publisher.duplicate();

    // Without a listener, ioredis reports connection trouble as an unhandled
    // error event and the real failure arrives as an opaque 'Connection is
    // closed' stack. These clients reconnect on their own, so a blip is a
    // warning, not a fault.
    for (const client of [publisher, subscriber]) {
      client.on('error', (error: Error) => {
        this.logger.warn(`Redis connection trouble: ${error.message}`);
      });
    }

    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
    } catch (error) {
      // Deliberately fatal, unlike rate limiting. Without Redis a broadcast
      // reaches only the clients on this instance, so the queue would look
      // live and silently be wrong for everyone else. Better to refuse to
      // start and let the platform restart us once Redis is up.
      publisher.disconnect();
      subscriber.disconnect();

      throw new Error(
        `Socket.IO needs Redis and could not reach it at ${redacted(redisUrl)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.clients = [publisher, subscriber];
    this.adapterConstructor = createAdapter(publisher, subscriber);
    this.logger.log('Socket.IO is broadcasting through Redis');
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.quit().catch(() => client.disconnect())));
    this.clients = [];
  }

  override createIOServer(port: number, options?: ServerOptions): unknown {
    const server = super.createIOServer(port, options) as {
      adapter: (factory: ReturnType<typeof createAdapter>) => void;
    };

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}

/** Keeps any password in the connection string out of the logs. */
function redacted(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return 'the configured REDIS_URL';
  }
}
