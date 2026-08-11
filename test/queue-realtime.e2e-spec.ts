import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingStatus, Role } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { QUEUE_UPDATED } from '../src/queue/queue.gateway';

interface Identified {
  id: string;
}

interface QueueEntry {
  bookingId: string;
  position: number | null;
  status: BookingStatus;
  customerName: string | null;
  isYours: boolean;
}

interface QueuePayload {
  shopId: string;
  date: string;
  entries: QueueEntry[];
}

const RUN = Date.now();
const emailFor = (label: string) => `queue-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

const DATE = '2027-06-16';
const DAY_OF_WEEK = 3;
const NINE_AM = '2027-06-16T02:00:00.000Z';
const NINE_THIRTY = '2027-06-16T02:30:00.000Z';
const TEN_AM = '2027-06-16T03:00:00.000Z';

describe('Real-time queue (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  const http = () => request(app.getHttpServer() as Server);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let ownerToken: string;
  let staffToken: string;
  let customerAToken: string;
  let customerBToken: string;
  let customerAId: string;
  let shopId: string;
  let serviceId: string;
  let staffId: string;

  const sockets: Socket[] = [];

  /** Connects, waits for the connection to be live, and tracks it for cleanup. */
  const connect = async (token: string): Promise<Socket> => {
    const socket = io(`${baseUrl}/queue`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('socket did not connect in time')), 5000);
    });

    return socket;
  };

  /** Resolves with the next payload of `event`, or rejects if none arrives. */
  const nextEvent = <T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${event} within ${timeoutMs}ms`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const watch = async (socket: Socket, date = DATE): Promise<QueuePayload> => {
    // The gateway pushes the current queue on joining, so the caller starts
    // from a known state rather than the first change that happens to occur.
    const initial = nextEvent<QueuePayload>(socket, QUEUE_UPDATED);
    socket.emit('queue.watch', { shopId, date });
    return initial;
  };

  const book = (token: string, startTime: string) =>
    http()
      .post(`/shops/${shopId}/bookings`)
      .set(auth(token))
      .send({ serviceId, staffId, startTime });

  const setStatus = (bookingId: string, status: BookingStatus, token = ownerToken) =>
    http().patch(`/shops/${shopId}/bookings/${bookingId}/status`).set(auth(token)).send({ status });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // A real port, because these tests speak websocket rather than HTTP.
    await app.listen(0);
    prisma = app.get(PrismaService);

    const address = (app.getHttpServer() as Server).address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const registerAs = async (label: string, role: Role) => {
      const res = await http()
        .post('/auth/register')
        .send({ email: emailFor(label), name: `User ${label}`, password: PASSWORD, role })
        .expect(201);
      return res.body as { accessToken: string; user: Identified };
    };

    ownerToken = (await registerAs('owner', Role.OWNER)).accessToken;
    const customerA = await registerAs('customer-a', Role.CUSTOMER);
    customerAToken = customerA.accessToken;
    customerAId = customerA.user.id;
    customerBToken = (await registerAs('customer-b', Role.CUSTOMER)).accessToken;

    const shop = await http()
      .post('/shops')
      .set(auth(ownerToken))
      .send({ name: 'Barbershop Antrian', address: 'Jl. Melati No. 12', timezone: 'Asia/Jakarta' })
      .expect(201);
    shopId = (shop.body as Identified).id;

    const service = await http()
      .post(`/shops/${shopId}/services`)
      .set(auth(ownerToken))
      .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
      .expect(201);
    serviceId = (service.body as Identified).id;

    // A staff member with a login, so their authority can be tested too.
    const staff = await http()
      .post(`/shops/${shopId}/staff`)
      .set(auth(ownerToken))
      .send({ name: 'Andi', email: emailFor('kapster'), password: PASSWORD })
      .expect(201);
    staffId = (staff.body as Identified).id;

    const staffLogin = await http()
      .post('/auth/login')
      .send({ email: emailFor('kapster'), password: PASSWORD })
      .expect(200);
    staffToken = (staffLogin.body as { accessToken: string }).accessToken;

    await http()
      .put(`/shops/${shopId}/working-hours`)
      .set(auth(ownerToken))
      .send({ hours: [{ dayOfWeek: DAY_OF_WEEK, open: '09:00', close: '17:00' }] })
      .expect(200);
  });

  afterEach(async () => {
    while (sockets.length) {
      sockets.pop()?.disconnect();
    }
    await prisma.booking.deleteMany({ where: { shopId } });
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: `queue-${RUN}-` } } });
    await app?.close();
  });

  describe('the live guarantee', () => {
    it('reflects a status change in another client without it asking', async () => {
      // This is the Phase 5 acceptance criterion: the owner changes a status,
      // and a customer who never issued a request learns about it.
      const created = await book(customerAToken, NINE_AM).expect(201);
      const bookingId = (created.body as Identified).id;

      const customerSocket = await connect(customerAToken);
      const initial = await watch(customerSocket);
      expect(initial.entries[0].status).toBe(BookingStatus.BOOKED);

      const pushed = nextEvent<QueuePayload>(customerSocket, QUEUE_UPDATED);
      await setStatus(bookingId, BookingStatus.IN_PROGRESS).expect(200);

      const update = await pushed;
      expect(update.entries[0].status).toBe(BookingStatus.IN_PROGRESS);
      expect(update.entries[0].position).toBeNull();
    });

    it('reaches every client watching the same shop', async () => {
      const created = await book(customerAToken, NINE_AM).expect(201);
      const bookingId = (created.body as Identified).id;

      const [socketA, socketB] = await Promise.all([
        connect(customerAToken),
        connect(customerBToken),
      ]);
      await Promise.all([watch(socketA), watch(socketB)]);

      const both = Promise.all([
        nextEvent<QueuePayload>(socketA, QUEUE_UPDATED),
        nextEvent<QueuePayload>(socketB, QUEUE_UPDATED),
      ]);
      await setStatus(bookingId, BookingStatus.WAITING).expect(200);

      const [fromA, fromB] = await both;
      expect(fromA.entries[0].status).toBe(BookingStatus.WAITING);
      expect(fromB.entries[0].status).toBe(BookingStatus.WAITING);
    });

    it('announces a new booking to watchers', async () => {
      const socket = await connect(customerAToken);
      const initial = await watch(socket);
      expect(initial.entries).toHaveLength(0);

      const pushed = nextEvent<QueuePayload>(socket, QUEUE_UPDATED);
      await book(customerBToken, NINE_AM).expect(201);

      const update = await pushed;
      expect(update.entries).toHaveLength(1);
      expect(update.entries[0].position).toBe(1);
    });

    it('renumbers the line as people are served', async () => {
      const first = await book(customerAToken, NINE_AM).expect(201);
      await book(customerBToken, NINE_THIRTY).expect(201);
      await book(customerAToken, TEN_AM).expect(201);

      const socket = await connect(customerAToken);
      const initial = await watch(socket);
      expect(initial.entries.map((entry) => entry.position)).toEqual([1, 2, 3]);

      const pushed = nextEvent<QueuePayload>(socket, QUEUE_UPDATED);
      await setStatus((first.body as Identified).id, BookingStatus.IN_PROGRESS).expect(200);

      // The person in the chair drops out of the numbering; the rest move up.
      expect((await pushed).entries.map((entry) => entry.position)).toEqual([null, 1, 2]);
    });

    it('labels each payload with the date it describes, so a client can filter', async () => {
      // Rooms are per shop, so a client watching one day can hear about another.
      // The date on the payload is what lets it tell them apart.
      const socket = await connect(customerAToken);
      const initial = await watch(socket);
      expect(initial.date).toBe(DATE);

      const pushed = nextEvent<QueuePayload>(socket, QUEUE_UPDATED);
      await book(customerBToken, NINE_AM).expect(201);

      const update = await pushed;
      expect(update.date).toBe(DATE);
      expect(update.shopId).toBe(shopId);
    });

    it('does not leak a change to a client watching a different shop', async () => {
      const otherShop = await http()
        .post('/shops')
        .set(auth(ownerToken))
        .send({ name: 'Cabang Lain', address: 'Jl. Lain No. 1' })
        .expect(201);

      const socket = await connect(customerBToken);
      const initial = nextEvent<QueuePayload>(socket, QUEUE_UPDATED);
      socket.emit('queue.watch', { shopId: (otherShop.body as Identified).id, date: DATE });
      await initial;

      const shouldNotArrive = nextEvent<QueuePayload>(socket, QUEUE_UPDATED, 1500);
      await book(customerAToken, NINE_AM).expect(201);

      await expect(shouldNotArrive).rejects.toThrow(/no queue.updated/);
    });

    it('stops sending updates after unwatch', async () => {
      const socket = await connect(customerAToken);
      await watch(socket);

      await new Promise<void>((resolve) =>
        socket.emit('queue.unwatch', { shopId }, () => resolve()),
      );

      const shouldNotArrive = nextEvent<QueuePayload>(socket, QUEUE_UPDATED, 1500);
      await book(customerBToken, NINE_AM).expect(201);

      await expect(shouldNotArrive).rejects.toThrow(/no queue.updated/);
    });

    it('broadcasts a customer cancelling their own booking', async () => {
      const created = await book(customerAToken, NINE_AM).expect(201);

      const socket = await connect(customerBToken);
      await watch(socket);

      const pushed = nextEvent<QueuePayload>(socket, QUEUE_UPDATED);
      await http()
        .patch(`/bookings/${(created.body as Identified).id}/cancel`)
        .set(auth(customerAToken))
        .expect(200);

      expect((await pushed).entries[0].status).toBe(BookingStatus.CANCELLED);
    });
  });

  describe('socket authentication', () => {
    it('refuses a connection with no token', async () => {
      const socket = io(`${baseUrl}/queue`, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);

      await expect(
        new Promise<void>((resolve, reject) => {
          socket.once('connect', () => reject(new Error('connected without a token')));
          socket.once('disconnect', () => resolve());
          socket.once('connect_error', () => resolve());
          setTimeout(() => reject(new Error('nothing happened')), 5000);
        }),
      ).resolves.toBeUndefined();
    });

    it('refuses a garbage token', async () => {
      const socket = io(`${baseUrl}/queue`, {
        auth: { token: 'not.a.jwt' },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);

      await expect(
        new Promise<void>((resolve, reject) => {
          socket.once('connect', () => reject(new Error('connected with a bad token')));
          socket.once('disconnect', () => resolve());
          socket.once('connect_error', () => resolve());
          setTimeout(() => reject(new Error('nothing happened')), 5000);
        }),
      ).resolves.toBeUndefined();
    });

    it('rejects a watch with no shopId', async () => {
      const socket = await connect(customerAToken);

      const reply = await new Promise<{ error?: string }>((resolve) =>
        socket.emit('queue.watch', {}, resolve),
      );

      expect(reply.error).toMatch(/shopId/);
    });
  });

  describe('who may change a status', () => {
    let bookingId: string;

    beforeEach(async () => {
      const created = await book(customerAToken, NINE_AM).expect(201);
      bookingId = (created.body as Identified).id;
    });

    it('allows the shop’s owner', async () => {
      await setStatus(bookingId, BookingStatus.WAITING, ownerToken).expect(200);
    });

    it('allows a staff member of that shop', async () => {
      await setStatus(bookingId, BookingStatus.WAITING, staffToken).expect(200);
    });

    it('refuses a customer, even for their own booking', async () => {
      await setStatus(bookingId, BookingStatus.IN_PROGRESS, customerAToken).expect(404);
    });

    it('refuses an owner of a different shop', async () => {
      const other = await http()
        .post('/auth/register')
        .send({
          email: emailFor('other-owner'),
          name: 'Other',
          password: PASSWORD,
          role: Role.OWNER,
        })
        .expect(201);

      await setStatus(
        bookingId,
        BookingStatus.WAITING,
        (other.body as { accessToken: string }).accessToken,
      ).expect(404);
    });
  });

  describe('transition rules over HTTP', () => {
    let bookingId: string;

    beforeEach(async () => {
      const created = await book(customerAToken, NINE_AM).expect(201);
      bookingId = (created.body as Identified).id;
    });

    it('walks the happy path', async () => {
      await setStatus(bookingId, BookingStatus.WAITING).expect(200);
      await setStatus(bookingId, BookingStatus.IN_PROGRESS).expect(200);
      await setStatus(bookingId, BookingStatus.DONE).expect(200);
    });

    it('refuses to skip straight to DONE', async () => {
      await setStatus(bookingId, BookingStatus.DONE).expect(400);
    });

    it('refuses to move backwards', async () => {
      await setStatus(bookingId, BookingStatus.IN_PROGRESS).expect(200);
      await setStatus(bookingId, BookingStatus.WAITING).expect(400);
    });

    it('refuses to change a finished booking', async () => {
      await setStatus(bookingId, BookingStatus.IN_PROGRESS).expect(200);
      await setStatus(bookingId, BookingStatus.DONE).expect(200);
      await setStatus(bookingId, BookingStatus.CANCELLED).expect(400);
    });

    it('refuses an unknown status', async () => {
      await http()
        .patch(`/shops/${shopId}/bookings/${bookingId}/status`)
        .set(auth(ownerToken))
        .send({ status: 'NAPPING' })
        .expect(400);
    });

    it('frees the slot again when cancelled, so it can be rebooked', async () => {
      await setStatus(bookingId, BookingStatus.CANCELLED).expect(200);

      await book(customerBToken, NINE_AM).expect(201);
    });
  });

  describe('the HTTP queue view', () => {
    beforeEach(async () => {
      await book(customerAToken, NINE_AM).expect(201);
      await book(customerBToken, NINE_THIRTY).expect(201);
    });

    const queueAs = (token: string) =>
      http().get(`/shops/${shopId}/queue`).set(auth(token)).query({ date: DATE });

    it('shows customer names to the owner', async () => {
      const res = await queueAs(ownerToken).expect(200);
      const { entries } = res.body as QueuePayload;

      expect(entries).toHaveLength(2);
      expect(entries[0].customerName).toBe('User customer-a');
    });

    it('shows customer names to the shop’s staff', async () => {
      const res = await queueAs(staffToken).expect(200);

      expect((res.body as QueuePayload).entries[0].customerName).toBe('User customer-a');
    });

    it('hides customer names from a customer but marks their own', async () => {
      const res = await queueAs(customerAToken).expect(200);
      const { entries } = res.body as QueuePayload;

      expect(entries.every((entry) => entry.customerName === null)).toBe(true);
      expect(entries.filter((entry) => entry.isYours)).toHaveLength(1);
      expect(entries.find((entry) => entry.isYours)?.position).toBe(1);
    });

    it('hides names from an owner who does not own this shop', async () => {
      const other = await http()
        .post('/auth/register')
        .send({
          email: emailFor('nosy-owner'),
          name: 'Nosy',
          password: PASSWORD,
          role: Role.OWNER,
        })
        .expect(201);

      const res = await queueAs((other.body as { accessToken: string }).accessToken).expect(200);

      expect((res.body as QueuePayload).entries.every((e) => e.customerName === null)).toBe(true);
    });

    it('defaults to today in the shop’s own time zone', async () => {
      const res = await http().get(`/shops/${shopId}/queue`).set(auth(ownerToken)).expect(200);

      // Today in Jakarta, which is not necessarily today where the test runs.
      const jakartaToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      expect((res.body as QueuePayload).date).toBe(jakartaToday);
    });

    it('rejects a malformed date', async () => {
      await http()
        .get(`/shops/${shopId}/queue`)
        .set(auth(ownerToken))
        .query({ date: '16-06-2027' })
        .expect(400);
    });

    it('requires authentication', async () => {
      await http().get(`/shops/${shopId}/queue`).expect(401);
    });

    it('excludes a customer id it was never asked about', async () => {
      const res = await queueAs(customerBToken).expect(200);

      expect(JSON.stringify(res.body)).not.toContain(customerAId);
    });
  });
});
