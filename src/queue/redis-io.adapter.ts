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

    await Promise.all([publisher.connect(), subscriber.connect()]);

    this.clients = [publisher, subscriber];
    this.adapterConstructor = createAdapter(publisher, subscriber);
    this.logger.log('Socket.IO is broadcasting through Redis');
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.clients.map((client) => client.quit()));
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
