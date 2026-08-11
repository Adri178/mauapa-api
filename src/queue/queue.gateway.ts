import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Role } from '@prisma/client';
import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { AccessTokenPayload } from '../auth/auth.types';
import { QueueService } from './queue.service';

export const QUEUE_UPDATED = 'queue.updated';

/** What the handshake middleware attaches to each socket once it is trusted. */
interface QueueSocketData {
  userId: string;
  role: Role;
}

type QueueSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, QueueSocketData>;
type QueueServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, QueueSocketData>;

/** One room per shop, so a broadcast reaches only that shop's watchers. */
export const roomFor = (shopId: string): string => `shop:${shopId}`;

/**
 * Live queue updates.
 *
 * Sockets bypass the HTTP pipeline entirely, so the global JwtAuthGuard never
 * runs. Authentication happens in a namespace middleware instead of in
 * handleConnection: handleConnection fires *after* the connection is
 * established, so a client would briefly be connected before being thrown out,
 * and would see a successful `connect` event. Rejecting in the middleware fails
 * the handshake itself — the client gets `connect_error` and is never connected
 * at all.
 */
@WebSocketGateway({ namespace: '/queue', cors: { origin: '*' } })
export class QueueGateway implements OnGatewayInit {
  private readonly logger = new Logger(QueueGateway.name);

  @WebSocketServer()
  private server!: QueueServer;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
  ) {}

  afterInit(server: QueueServer): void {
    server.use((socket, next) => {
      this.jwt
        .verifyAsync<AccessTokenPayload>(tokenFrom(socket), {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        })
        .then((payload) => {
          socket.data.userId = payload.sub;
          socket.data.role = payload.role;
          next();
        })
        .catch(() => next(new Error('Unauthorized')));
    });
  }

  /**
   * Watching a shop's queue is not privileged — a customer needs it to see
   * their own position, and the broadcast payload carries no customer names.
   */
  @SubscribeMessage('queue.watch')
  async watch(
    @ConnectedSocket() client: QueueSocket,
    @MessageBody() body: { shopId?: string; date?: string },
  ): Promise<{ watching: string; date: string } | { error: string }> {
    const shopId = body?.shopId;

    if (typeof shopId !== 'string' || !shopId) {
      return { error: 'shopId is required' };
    }

    await client.join(roomFor(shopId));

    // Send the current state immediately, so a client that connects mid-day
    // does not sit blank until something happens to change.
    const queue = await this.queue.forBroadcast(shopId, body?.date);
    client.emit(QUEUE_UPDATED, queue);

    return { watching: shopId, date: queue.date };
  }

  @SubscribeMessage('queue.unwatch')
  async unwatch(
    @ConnectedSocket() client: QueueSocket,
    @MessageBody() body: { shopId?: string },
  ): Promise<{ stopped: string } | { error: string }> {
    const shopId = body?.shopId;

    if (typeof shopId !== 'string' || !shopId) {
      return { error: 'shopId is required' };
    }

    await client.leave(roomFor(shopId));
    return { stopped: shopId };
  }

  /**
   * Pushes a shop's queue for one date to everyone watching that shop.
   *
   * Rooms are per shop, not per shop-and-date, so a client watching Tuesday can
   * receive a payload about Wednesday. Every payload therefore carries the date
   * it describes, and a client ignores the ones it is not showing. Splitting
   * rooms by date instead would leave a client watching the wrong room the
   * moment midnight passed in the shop's time zone.
   *
   * Failures are logged and swallowed: a booking that was successfully created
   * or advanced must not be reported as failed because a notification did not
   * go out.
   */
  async broadcast(shopId: string, date?: string): Promise<void> {
    try {
      const queue = await this.queue.forBroadcast(shopId, date);
      this.server.to(roomFor(shopId)).emit(QUEUE_UPDATED, queue);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast the queue for shop ${shopId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/** Accepts the token from the handshake auth object or the Authorization header. */
function tokenFrom(client: QueueSocket): string {
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  const fromAuth = auth?.token;
  if (typeof fromAuth === 'string' && fromAuth) {
    return fromAuth.replace(/^Bearer /i, '');
  }

  const header = client.handshake.headers.authorization;
  return typeof header === 'string' ? header.replace(/^Bearer /i, '') : '';
}
