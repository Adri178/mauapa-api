// Set before AppModule is imported, so ConfigModule sees rate limiting enabled.
process.env.THROTTLE_ENABLED = 'true';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingStatus, Role } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, trustProxy } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisThrottlerStorage } from '../src/throttling/redis-throttler.storage';
import { AUTH_THROTTLE, REGISTER_THROTTLE } from '../src/throttling/throttling.constants';

interface Identified {
  id: string;
}

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string[];
  path: string;
  timestamp: string;
  requestId?: string;
}

interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean };
}

const RUN = Date.now();
const emailFor = (label: string) => `hard-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';
const DATE = '2027-06-16';
const DAY_OF_WEEK = 3;

describe('Production hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer() as Server);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: string;
  let customer: string;
  let shopId: string;
  let serviceId: string;
  let staffId: string;

  /**
   * Each throttling test uses a fresh source address, because the limiter keys
   * on the caller and every test in this file shares one.
   */
  const fromNewClient = (path: string, method: 'get' | 'post' = 'post') =>
    http()
      [method](path)
      .set('X-Forwarded-For', `10.0.${Math.floor(RUN % 250)}.${counter++}`);

  let counter = 1;

  /**
   * Rate-limit counters live in Redis and outlive the process, so a previous
   * run of this file would otherwise leave this one starting part-way to the
   * limit — or, for registration with its ten-minute window, already blocked.
   * Clearing them is what makes these assertions mean anything.
   */
  const clearThrottleCounters = async (): Promise<void> => {
    const { default: Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    try {
      const keys = await redis.keys('throttle:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } finally {
      await redis.quit();
    }
  };

  beforeAll(async () => {
    await clearThrottleCounters();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    // Trusting the proxy header is what lets each test present a distinct
    // client address; a real deployment behind a load balancer needs it anyway.
    trustProxy(app, true);
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // Registration is rate limited too, so accounts are seeded straight into
    // the database rather than through the endpoint.
    const password = await import('../src/auth/password.service').then(
      (m) => new m.PasswordService(),
    );
    const passwordHash = await password.hash(PASSWORD);

    const ownerUser = await prisma.user.create({
      data: { email: emailFor('owner'), name: 'Owner', role: Role.OWNER, passwordHash },
    });
    const customerUser = await prisma.user.create({
      data: { email: emailFor('customer'), name: 'Customer', role: Role.CUSTOMER, passwordHash },
    });

    const login = async (email: string) => {
      const res = await fromNewClient('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      return (res.body as { accessToken: string }).accessToken;
    };

    owner = await login(ownerUser.email);
    customer = await login(customerUser.email);

    const shop = await http()
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Barbershop Keras', address: 'Jl. Melati No. 12', timezone: 'Asia/Jakarta' })
      .expect(201);
    shopId = (shop.body as Identified).id;

    const service = await http()
      .post(`/shops/${shopId}/services`)
      .set(auth(owner))
      .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
      .expect(201);
    serviceId = (service.body as Identified).id;

    const staff = await http()
      .post(`/shops/${shopId}/staff`)
      .set(auth(owner))
      .send({ name: 'Andi' })
      .expect(201);
    staffId = (staff.body as Identified).id;

    await http()
      .put(`/shops/${shopId}/working-hours`)
      .set(auth(owner))
      .send({ hours: [{ dayOfWeek: DAY_OF_WEEK, open: '09:00', close: '17:00' }] })
      .expect(200);
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: `hard-${RUN}-` } } });
    // Leave Redis as we found it, so the next run starts clean too.
    await clearThrottleCounters();
    await app?.get(RedisThrottlerStorage).onModuleDestroy();
    await app?.close();
  });

  describe('rate limiting', () => {
    it('lets a normal number of login attempts through, then blocks', async () => {
      const address = `10.9.9.${counter++}`;
      const attempt = () =>
        http()
          .post('/auth/login')
          .set('X-Forwarded-For', address)
          .send({ email: emailFor('owner'), password: 'wrong-password' });

      const statuses: number[] = [];
      for (let i = 0; i < AUTH_THROTTLE.default.limit + 2; i++) {
        statuses.push((await attempt()).status);
      }

      // Every attempt up to the limit is answered on its merits (401 for a bad
      // password); only after that does the limiter step in.
      expect(statuses.slice(0, AUTH_THROTTLE.default.limit).every((s) => s === 401)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    });

    it('limits registration harder than login', async () => {
      const address = `10.9.8.${counter++}`;
      const attempt = (n: number) =>
        http()
          .post('/auth/register')
          .set('X-Forwarded-For', address)
          .send({
            email: emailFor(`flood-${n}`),
            name: 'Flood',
            password: PASSWORD,
            role: Role.CUSTOMER,
          });

      const statuses: number[] = [];
      for (let i = 0; i < REGISTER_THROTTLE.default.limit + 1; i++) {
        statuses.push((await attempt(i)).status);
      }

      expect(statuses.filter((s) => s === 201)).toHaveLength(REGISTER_THROTTLE.default.limit);
      expect(statuses.at(-1)).toBe(429);
    });

    it('counts each caller separately', async () => {
      const flood = async (address: string) => {
        for (let i = 0; i < AUTH_THROTTLE.default.limit; i++) {
          await http()
            .post('/auth/login')
            .set('X-Forwarded-For', address)
            .send({ email: emailFor('owner'), password: 'wrong-password' });
        }
      };

      const blocked = `10.9.7.${counter++}`;
      const innocent = `10.9.7.${counter++}`;
      await flood(blocked);

      // The flooder is now blocked…
      await http()
        .post('/auth/login')
        .set('X-Forwarded-For', blocked)
        .send({ email: emailFor('owner'), password: 'wrong-password' })
        .expect(429);

      // …and somebody else is entirely unaffected.
      await http()
        .post('/auth/login')
        .set('X-Forwarded-For', innocent)
        .send({ email: emailFor('owner'), password: PASSWORD })
        .expect(200);
    });

    it('answers 429 in the standard error shape', async () => {
      const address = `10.9.6.${counter++}`;
      let body: ErrorBody | undefined;

      for (let i = 0; i < AUTH_THROTTLE.default.limit + 2; i++) {
        const res = await http()
          .post('/auth/login')
          .set('X-Forwarded-For', address)
          .send({ email: emailFor('owner'), password: 'wrong-password' });
        if (res.status === 429) {
          body = res.body as ErrorBody;
          break;
        }
      }

      expect(body?.statusCode).toBe(429);
      expect(Array.isArray(body?.message)).toBe(true);
      expect(body?.path).toBe('/auth/login');
    });

    it('leaves unthrottled routes alone', async () => {
      for (let i = 0; i < 30; i++) {
        await http().get('/health').expect(200);
      }
    });
  });

  describe('the error shape', () => {
    it('is the same for a validation failure as for anything else', async () => {
      const res = await http()
        .post('/shops')
        .set(auth(owner))
        .send({ name: 'x', address: 'y' })
        .expect(400);

      const body = res.body as ErrorBody;
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe('Bad Request');
      expect(Array.isArray(body.message)).toBe(true);
      expect(body.message.length).toBeGreaterThan(0);
      expect(body.path).toBe('/shops');
      expect(typeof body.timestamp).toBe('string');
    });

    it('returns message as an array even for a single-string error', async () => {
      const res = await http().get('/shops').expect(401);

      const body = res.body as ErrorBody;
      expect(body.message).toEqual(['Unauthorized']);
      expect(body.error).toBe('Unauthorized');
    });

    it('uses the same shape for 403', async () => {
      const res = await http().get('/shops').set(auth(customer)).expect(403);

      expect((res.body as ErrorBody).error).toBe('Forbidden');
      expect(Array.isArray((res.body as ErrorBody).message)).toBe(true);
    });

    it('uses the same shape for 404', async () => {
      const res = await http()
        .get('/shops/00000000-0000-4000-8000-000000000000')
        .set(auth(owner))
        .expect(404);

      expect((res.body as ErrorBody).error).toBe('Not Found');
      expect((res.body as ErrorBody).message).toEqual(['Shop not found']);
    });

    it('uses the same shape for 409', async () => {
      await http()
        .post(`/shops/${shopId}/services`)
        .set(auth(owner))
        .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
        .expect(409);

      const res = await http()
        .post(`/shops/${shopId}/services`)
        .set(auth(owner))
        .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
        .expect(409);

      expect((res.body as ErrorBody).error).toBe('Conflict');
    });

    it('never carries a requestId on a client error', async () => {
      const res = await http().get('/shops').expect(401);

      expect((res.body as ErrorBody).requestId).toBeUndefined();
    });

    it('does not leak internals when something unexpected breaks', async () => {
      // A UUID that parses but names no row, forced through a path that hands
      // the id straight to Prisma.
      const res = await http()
        .get('/bookings/00000000-0000-4000-8000-000000000000')
        .set(auth(customer))
        .expect(404);

      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain('prisma');
      expect(serialised).not.toContain('Invalid `');
    });
  });

  describe('pagination', () => {
    const NINE_AM = '2027-06-16T02:00:00.000Z';

    beforeAll(async () => {
      // Twelve bookings, half an hour apart from 09:00.
      const base = new Date(NINE_AM).getTime();
      const customerRow = await prisma.user.findUniqueOrThrow({
        where: { email: emailFor('customer') },
      });

      for (let i = 0; i < 12; i++) {
        const start = new Date(base + i * 30 * 60_000);
        await prisma.booking.create({
          data: {
            shopId,
            serviceId,
            staffId,
            customerId: customerRow.id,
            startTime: start,
            endTime: new Date(start.getTime() + 30 * 60_000),
            status: i % 4 === 0 ? BookingStatus.CANCELLED : BookingStatus.BOOKED,
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.booking.deleteMany({ where: { shopId } });
    });

    const shopBookings = (query: Record<string, string | number>) =>
      http().get(`/shops/${shopId}/bookings`).set(auth(owner)).query(query);

    it('defaults to the first page', async () => {
      const res = await shopBookings({}).expect(200);
      const page = res.body as Page<Identified>;

      expect(page.meta.page).toBe(1);
      expect(page.meta.limit).toBe(20);
      expect(page.meta.total).toBe(12);
      expect(page.meta.totalPages).toBe(1);
      expect(page.meta.hasNextPage).toBe(false);
      expect(page.data).toHaveLength(12);
    });

    it('splits into pages and reports the total honestly', async () => {
      const first = await shopBookings({ limit: 5 }).expect(200);
      const page = first.body as Page<Identified>;

      expect(page.data).toHaveLength(5);
      expect(page.meta.total).toBe(12);
      expect(page.meta.totalPages).toBe(3);
      expect(page.meta.hasNextPage).toBe(true);
    });

    it('returns different rows on the next page', async () => {
      const [first, second] = await Promise.all([
        shopBookings({ limit: 5, page: 1 }).expect(200),
        shopBookings({ limit: 5, page: 2 }).expect(200),
      ]);

      const ids = (res: { body: unknown }) =>
        (res.body as Page<Identified>).data.map((row) => row.id);

      expect(ids(first)).not.toEqual(ids(second));
      expect(ids(first).some((id) => ids(second).includes(id))).toBe(false);
    });

    it('reports the last page as having no next', async () => {
      const res = await shopBookings({ limit: 5, page: 3 }).expect(200);
      const page = res.body as Page<Identified>;

      expect(page.data).toHaveLength(2);
      expect(page.meta.hasNextPage).toBe(false);
    });

    it('returns an empty page past the end rather than an error', async () => {
      const res = await shopBookings({ limit: 5, page: 99 }).expect(200);

      expect((res.body as Page<Identified>).data).toEqual([]);
    });

    it('refuses a limit beyond the ceiling', async () => {
      await shopBookings({ limit: 500 }).expect(400);
    });

    it('refuses a page below one', async () => {
      await shopBookings({ page: 0 }).expect(400);
    });

    it('refuses a non-numeric page', async () => {
      await shopBookings({ page: 'first' }).expect(400);
    });
  });

  describe('filtering', () => {
    const NINE_AM = '2027-06-16T02:00:00.000Z';

    beforeAll(async () => {
      const customerRow = await prisma.user.findUniqueOrThrow({
        where: { email: emailFor('customer') },
      });
      const base = new Date(NINE_AM).getTime();

      for (let i = 0; i < 6; i++) {
        const start = new Date(base + i * 30 * 60_000);
        await prisma.booking.create({
          data: {
            shopId,
            serviceId,
            staffId,
            customerId: customerRow.id,
            startTime: start,
            endTime: new Date(start.getTime() + 30 * 60_000),
            status: i < 2 ? BookingStatus.CANCELLED : BookingStatus.BOOKED,
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.booking.deleteMany({ where: { shopId } });
    });

    const shopBookings = (query: Record<string, string>) =>
      http().get(`/shops/${shopId}/bookings`).set(auth(owner)).query(query);

    it('filters by status', async () => {
      const res = await shopBookings({ status: BookingStatus.CANCELLED }).expect(200);
      const page = res.body as Page<{ status: BookingStatus }>;

      expect(page.meta.total).toBe(2);
      expect(page.data.every((row) => row.status === BookingStatus.CANCELLED)).toBe(true);
    });

    it('filters by date in the shop’s own time zone', async () => {
      const onTheDay = await shopBookings({ date: DATE }).expect(200);
      const dayBefore = await shopBookings({ date: '2027-06-15' }).expect(200);

      expect((onTheDay.body as Page<unknown>).meta.total).toBe(6);
      expect((dayBefore.body as Page<unknown>).meta.total).toBe(0);
    });

    it('filters by staff member', async () => {
      const other = await http()
        .post(`/shops/${shopId}/staff`)
        .set(auth(owner))
        .send({ name: 'Budi' })
        .expect(201);

      const mine = await shopBookings({ staffId }).expect(200);
      const theirs = await shopBookings({ staffId: (other.body as Identified).id }).expect(200);

      expect((mine.body as Page<unknown>).meta.total).toBe(6);
      expect((theirs.body as Page<unknown>).meta.total).toBe(0);
    });

    it('combines filters', async () => {
      const res = await shopBookings({ status: BookingStatus.BOOKED, date: DATE }).expect(200);

      expect((res.body as Page<unknown>).meta.total).toBe(4);
    });

    it('orders by start time, ascending by default', async () => {
      const res = await shopBookings({}).expect(200);
      const starts = (res.body as Page<{ startTime: string }>).data.map((row) => row.startTime);

      expect([...starts].sort()).toEqual(starts);
    });

    it('reverses on request', async () => {
      const res = await shopBookings({ order: 'desc' }).expect(200);
      const starts = (res.body as Page<{ startTime: string }>).data.map((row) => row.startTime);

      expect([...starts].sort().reverse()).toEqual(starts);
    });

    it('refuses an unknown status', async () => {
      await shopBookings({ status: 'NAPPING' }).expect(400);
    });

    it('refuses an impossible date', async () => {
      await shopBookings({ date: '2027-02-30' }).expect(400);
    });

    it('refuses an unknown query parameter', async () => {
      await shopBookings({ sneaky: 'yes' }).expect(400);
    });

    it('is denied to an owner who does not run the shop', async () => {
      await http().get(`/shops/${shopId}/bookings`).set(auth(customer)).expect(404);
    });

    it('paginates the customer’s own bookings too', async () => {
      const res = await http()
        .get('/bookings/me')
        .set(auth(customer))
        .query({ limit: 4 })
        .expect(200);
      const page = res.body as Page<unknown>;

      expect(page.data).toHaveLength(4);
      expect(page.meta.total).toBe(6);
    });
  });

  describe('Swagger', () => {
    it('documents every route the app exposes', async () => {
      const res = await http().get('/docs-json').expect(200);
      const spec = res.body as {
        paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
      };

      const documented = Object.keys(spec.paths);
      for (const expected of [
        '/auth/register',
        '/auth/login',
        '/auth/refresh',
        '/auth/logout',
        '/auth/me',
        '/shops',
        '/shops/{shopId}',
        '/shops/{shopId}/services',
        '/shops/{shopId}/staff',
        '/shops/{shopId}/working-hours',
        '/shops/{shopId}/availability',
        '/shops/{shopId}/bookings',
        '/shops/{shopId}/queue',
        '/bookings/me',
        '/health',
      ]) {
        expect(documented).toContain(expected);
      }
    });

    it('gives every operation a summary and a tag', async () => {
      const res = await http().get('/docs-json').expect(200);
      const spec = res.body as {
        paths: Record<string, Record<string, { summary?: string; tags?: string[] }>>;
      };

      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          expect(operation.summary && operation.summary.length > 0).toBe(true);
          expect(operation.tags?.length).toBeGreaterThan(0);
          if (!operation.summary) {
            throw new Error(`${method.toUpperCase()} ${path} has no summary`);
          }
        }
      }
    });
  });
});
