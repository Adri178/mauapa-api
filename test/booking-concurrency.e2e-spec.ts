import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingStatus, Role } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface Identified {
  id: string;
}

const RUN = Date.now();
const emailFor = (label: string) => `booking-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

// A Wednesday well in the future, so "now" never catches up with it.
const DATE = '2027-06-16';
const DAY_OF_WEEK = 3;
/** 09:00 Asia/Jakarta. */
const NINE_AM = '2027-06-16T02:00:00.000Z';

describe('Bookings and double-booking prevention (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer() as Server);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: string;
  let shopId: string;
  let serviceId: string;
  let staffId: string;
  let otherStaffId: string;
  /** Independent customer accounts, so races are between different people. */
  const customers: string[] = [];

  const bookAs = (token: string, startTime: string, overrides: Record<string, unknown> = {}) =>
    http()
      .post(`/shops/${shopId}/bookings`)
      .set(auth(token))
      .send({ serviceId, staffId, startTime, ...overrides });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const registerAs = async (label: string, role: Role): Promise<string> => {
      const res = await http()
        .post('/auth/register')
        .send({ email: emailFor(label), name: 'Test User', password: PASSWORD, role })
        .expect(201);
      return (res.body as { accessToken: string }).accessToken;
    };

    owner = await registerAs('owner', Role.OWNER);
    for (let i = 0; i < 12; i++) {
      customers.push(await registerAs(`customer-${i}`, Role.CUSTOMER));
    }

    const shop = await http()
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Barbershop Race', address: 'Jl. Melati No. 12', timezone: 'Asia/Jakarta' })
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

    const other = await http()
      .post(`/shops/${shopId}/staff`)
      .set(auth(owner))
      .send({ name: 'Budi' })
      .expect(201);
    otherStaffId = (other.body as Identified).id;

    await http()
      .put(`/shops/${shopId}/working-hours`)
      .set(auth(owner))
      .send({ hours: [{ dayOfWeek: DAY_OF_WEEK, open: '09:00', close: '17:00' }] })
      .expect(200);
  });

  afterEach(async () => {
    await prisma.booking.deleteMany({ where: { shopId } });
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: `booking-${RUN}-` } } });
    await app?.close();
  });

  describe('the concurrency guarantee', () => {
    it('lets exactly one of two simultaneous requests for the same slot succeed', async () => {
      // Both requests are in flight before either can finish: this is the race
      // that a check-then-insert in application code would lose.
      const [first, second] = await Promise.all([
        bookAs(customers[0], NINE_AM),
        bookAs(customers[1], NINE_AM),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([201, 409]);

      const stored = await prisma.booking.count({
        where: { staffId, startTime: new Date(NINE_AM) },
      });
      expect(stored).toBe(1);
    });

    it('lets exactly one of twelve simultaneous requests succeed', async () => {
      const responses = await Promise.all(customers.map((token) => bookAs(token, NINE_AM)));

      const statuses = responses.map((res) => res.status);

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      // Every loser must be a clean 409 — no deadlock may escape as a 500.
      expect(statuses.filter((status) => status === 409)).toHaveLength(11);

      expect(await prisma.booking.count({ where: { staffId } })).toBe(1);
    });

    it('rejects overlapping — not merely identical — concurrent requests', async () => {
      // 09:00–09:30 against 09:15–09:45: different start times, same staff member.
      const [first, second] = await Promise.all([
        bookAs(customers[0], NINE_AM),
        bookAs(customers[1], '2027-06-16T02:15:00.000Z'),
      ]);

      expect([first.status, second.status].sort()).toEqual([201, 409]);
      expect(await prisma.booking.count({ where: { staffId } })).toBe(1);
    });

    it('lets both succeed when the requests are for different staff', async () => {
      const [first, second] = await Promise.all([
        bookAs(customers[0], NINE_AM),
        bookAs(customers[1], NINE_AM, { staffId: otherStaffId }),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(await prisma.booking.count({ where: { shopId } })).toBe(2);
    });

    it('lets both succeed when the slots merely touch', async () => {
      // 09:00–09:30 and 09:30–10:00. Back-to-back must stay legal.
      const [first, second] = await Promise.all([
        bookAs(customers[0], NINE_AM),
        bookAs(customers[1], '2027-06-16T02:30:00.000Z'),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
    });

    it('holds under repeated rounds, answering 409 and never 500', async () => {
      // Repeated because a race that fails one time in ten would otherwise pass.
      // Every status is asserted, not just the count of successes: a deadlock
      // that escaped as a 500 would still leave exactly one booking behind and
      // would otherwise slip through unnoticed.
      for (let round = 0; round < 10; round++) {
        const responses = await Promise.all([
          bookAs(customers[0], NINE_AM),
          bookAs(customers[1], NINE_AM),
          bookAs(customers[2], NINE_AM),
        ]);

        expect(responses.map((res) => res.status).sort()).toEqual([201, 409, 409]);
        expect(await prisma.booking.count({ where: { staffId } })).toBe(1);

        await prisma.booking.deleteMany({ where: { shopId } });
      }
    });
  });

  describe('sequential conflicts', () => {
    it('rejects a second booking for a slot already taken', async () => {
      await bookAs(customers[0], NINE_AM).expect(201);
      await bookAs(customers[1], NINE_AM).expect(409);
    });

    it('frees the slot once the booking is cancelled', async () => {
      const created = await bookAs(customers[0], NINE_AM).expect(201);

      await prisma.booking.update({
        where: { id: (created.body as Identified).id },
        data: { status: BookingStatus.CANCELLED },
      });

      // The exclusion constraint is partial, so a cancelled row stops blocking.
      await bookAs(customers[1], NINE_AM).expect(201);
    });

    it('removes the slot from availability once taken', async () => {
      await bookAs(customers[0], NINE_AM).expect(201);

      const res = await http()
        .get(`/shops/${shopId}/availability`)
        .set(auth(customers[1]))
        .query({ serviceId, staffId, date: DATE })
        .expect(200);

      const locals = (res.body as { slots: Array<{ startLocal: string }> }).slots.map(
        (slot) => slot.startLocal,
      );
      expect(locals).not.toContain('09:00');
      expect(locals).toContain('09:30');
    });
  });

  describe('what a booking may not be', () => {
    it('refuses a time outside opening hours', async () => {
      // 08:00 Jakarta, an hour before the shop opens.
      await bookAs(customers[0], '2027-06-16T01:00:00.000Z').expect(400);
    });

    it('refuses a service that would run past closing time', async () => {
      const long = await http()
        .post(`/shops/${shopId}/services`)
        .set(auth(owner))
        .send({ name: 'Perawatan Panjang', durationMinutes: 120, price: 200000 })
        .expect(201);

      // 16:00 + 2h = 18:00, an hour after close.
      await bookAs(customers[0], '2027-06-16T09:00:00.000Z', {
        serviceId: (long.body as Identified).id,
      }).expect(400);
    });

    it('refuses a closed day', async () => {
      // The Thursday after: no opening hours exist for it.
      await bookAs(customers[0], '2027-06-17T02:00:00.000Z').expect(400);
    });

    it('refuses a start that is not one of the offered slots', async () => {
      // 09:07 fits inside opening hours but was never advertised.
      await bookAs(customers[0], '2027-06-16T02:07:00.000Z').expect(400);
    });

    it('refuses a start carrying seconds', async () => {
      await bookAs(customers[0], '2027-06-16T02:00:30.000Z').expect(400);
    });

    it('refuses a time in the past', async () => {
      await bookAs(customers[0], '2020-01-01T02:00:00.000Z').expect(400);
    });

    it('refuses a malformed instant', async () => {
      await bookAs(customers[0], 'next tuesday').expect(400);
    });

    it('ignores a client-supplied end time instead of trusting it', async () => {
      // endTime is not part of the DTO; forbidNonWhitelisted rejects the attempt
      // rather than letting a client claim a one-minute haircut.
      await bookAs(customers[0], NINE_AM, { endTime: '2027-06-16T02:01:00.000Z' }).expect(400);
    });

    it('derives the end time from the service duration', async () => {
      const res = await bookAs(customers[0], NINE_AM).expect(201);
      const booking = res.body as { startTime: string; endTime: string; status: string };

      expect(booking.startTime).toBe(NINE_AM);
      expect(booking.endTime).toBe('2027-06-16T02:30:00.000Z');
      expect(booking.status).toBe(BookingStatus.BOOKED);
    });

    it('requires authentication', async () => {
      await http()
        .post(`/shops/${shopId}/bookings`)
        .send({ serviceId, staffId, startTime: NINE_AM })
        .expect(401);
    });

    it('refuses staff from another shop', async () => {
      const otherOwner = await http()
        .post('/auth/register')
        .send({
          email: emailFor('other-owner'),
          name: 'Other',
          password: PASSWORD,
          role: Role.OWNER,
        })
        .expect(201);
      const otherToken = (otherOwner.body as { accessToken: string }).accessToken;

      const otherShop = await http()
        .post('/shops')
        .set(auth(otherToken))
        .send({ name: 'Other Shop', address: 'Jl. Lain No. 1' })
        .expect(201);

      const foreignStaff = await http()
        .post(`/shops/${(otherShop.body as Identified).id}/staff`)
        .set(auth(otherToken))
        .send({ name: 'Orang Lain' })
        .expect(201);

      await bookAs(customers[0], NINE_AM, {
        staffId: (foreignStaff.body as Identified).id,
      }).expect(404);
    });
  });

  describe('reading your own bookings', () => {
    it('lists only the caller’s bookings', async () => {
      await bookAs(customers[0], NINE_AM).expect(201);
      await bookAs(customers[1], '2027-06-16T02:30:00.000Z').expect(201);

      const res = await http().get('/bookings/me').set(auth(customers[0])).expect(200);
      const mine = res.body as Array<{ startTime: string }>;

      expect(mine).toHaveLength(1);
      expect(mine[0].startTime).toBe(NINE_AM);
    });

    it("hides another customer's booking behind a 404", async () => {
      const created = await bookAs(customers[0], NINE_AM).expect(201);
      const id = (created.body as Identified).id;

      await http().get(`/bookings/${id}`).set(auth(customers[0])).expect(200);
      await http().get(`/bookings/${id}`).set(auth(customers[1])).expect(404);
    });
  });
});
