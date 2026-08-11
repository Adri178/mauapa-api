import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingStatus, Role } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AvailabilityService } from '../src/availability/availability.service';
import { PrismaService } from '../src/prisma/prisma.service';

interface Identified {
  id: string;
}

interface Slot {
  start: string;
  end: string;
  startLocal: string;
}

interface AvailabilityBody {
  open: boolean;
  timezone: string;
  durationMinutes: number;
  slots: Slot[];
}

const RUN = Date.now();
const emailFor = (label: string) => `avail-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

// A Wednesday, chosen far enough ahead that "now" never overtakes it.
const DATE = '2027-06-16';
const DAY_OF_WEEK = 3;

describe('Availability (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer() as Server);

  let owner: string;
  let customer: string;
  let customerId: string;
  let shopId: string;
  let serviceId: string;
  let staffId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const availability = (token: string, query: Record<string, string>) =>
    http().get(`/shops/${shopId}/availability`).set(auth(token)).query(query);

  const defaultQuery = () => ({ serviceId, staffId, date: DATE });

  /** Places a booking directly; the create endpoint arrives in Phase 4. */
  const book = (startIso: string, endIso: string, status: BookingStatus = BookingStatus.BOOKED) =>
    prisma.booking.create({
      data: {
        shopId,
        serviceId,
        staffId,
        customerId,
        startTime: new Date(startIso),
        endTime: new Date(endIso),
        status,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const registerAs = async (label: string, role: Role) => {
      const res = await http()
        .post('/auth/register')
        .send({ email: emailFor(label), name: 'Test User', password: PASSWORD, role })
        .expect(201);
      return res.body as { accessToken: string; user: Identified };
    };

    owner = (await registerAs('owner', Role.OWNER)).accessToken;
    const customerAccount = await registerAs('customer', Role.CUSTOMER);
    customer = customerAccount.accessToken;
    customerId = customerAccount.user.id;

    const shop = await http()
      .post('/shops')
      .set(auth(owner))
      .send({ name: 'Barbershop Slot', address: 'Jl. Melati No. 12', timezone: 'Asia/Jakarta' })
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

    // Open 09:00–12:00 on the test weekday only.
    await http()
      .put(`/shops/${shopId}/working-hours`)
      .set(auth(owner))
      .send({ hours: [{ dayOfWeek: DAY_OF_WEEK, open: '09:00', close: '12:00' }] })
      .expect(200);
  });

  afterEach(async () => {
    await prisma.booking.deleteMany({ where: { shopId } });
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: `avail-${RUN}-` } } });
    await app?.close();
  });

  describe('the open window', () => {
    it('offers every 15-minute start that finishes by closing time', async () => {
      const res = await availability(customer, defaultQuery()).expect(200);
      const body = res.body as AvailabilityBody;

      expect(body.open).toBe(true);
      expect(body.timezone).toBe('Asia/Jakarta');
      // 09:00 … 11:30 inclusive, on the quarter hour.
      expect(body.slots.map((slot) => slot.startLocal)).toEqual([
        '09:00',
        '09:15',
        '09:30',
        '09:45',
        '10:00',
        '10:15',
        '10:30',
        '10:45',
        '11:00',
        '11:15',
        '11:30',
      ]);
    });

    it('returns instants that match the shop’s wall clock', async () => {
      const res = await availability(customer, defaultQuery()).expect(200);
      const [first] = (res.body as AvailabilityBody).slots;

      // 09:00 in Asia/Jakarta (UTC+7) is 02:00Z, and a 30-minute service ends at 02:30Z.
      expect(first.start).toBe('2027-06-16T02:00:00.000Z');
      expect(first.end).toBe('2027-06-16T02:30:00.000Z');
    });

    it('reports a closed day rather than pretending it is empty', async () => {
      // The Thursday after: no working hours row exists for it.
      const res = await availability(customer, { ...defaultQuery(), date: '2027-06-17' }).expect(
        200,
      );
      const body = res.body as AvailabilityBody;

      expect(body.open).toBe(false);
      expect(body.slots).toEqual([]);
    });
  });

  describe('existing bookings', () => {
    it('hides a slot that is exactly booked', async () => {
      await book('2027-06-16T02:00:00Z', '2027-06-16T02:30:00Z');

      const res = await availability(customer, defaultQuery()).expect(200);
      const locals = (res.body as AvailabilityBody).slots.map((slot) => slot.startLocal);

      expect(locals).not.toContain('09:00');
      expect(locals[0]).toBe('09:30');
    });

    it('hides every slot a booking partly covers', async () => {
      // 09:20–09:50 clashes with the 09:00, 09:15, 09:30 and 09:45 starts.
      await book('2027-06-16T02:20:00Z', '2027-06-16T02:50:00Z');

      const res = await availability(customer, defaultQuery()).expect(200);
      const locals = (res.body as AvailabilityBody).slots.map((slot) => slot.startLocal);

      expect(locals).not.toContain('09:00');
      expect(locals).not.toContain('09:15');
      expect(locals).not.toContain('09:30');
      expect(locals).not.toContain('09:45');
      expect(locals).toContain('10:00');
    });

    it('still offers a slot that ends exactly when a booking starts', async () => {
      // Back-to-back is normal; the boundary must not count as a clash.
      await book('2027-06-16T02:30:00Z', '2027-06-16T03:00:00Z');

      const res = await availability(customer, defaultQuery()).expect(200);
      const locals = (res.body as AvailabilityBody).slots.map((slot) => slot.startLocal);

      expect(locals).toContain('09:00');
      expect(locals).toContain('10:00');
      expect(locals).not.toContain('09:30');
    });

    it('frees the slot again once the booking is cancelled', async () => {
      await book('2027-06-16T02:00:00Z', '2027-06-16T02:30:00Z', BookingStatus.CANCELLED);

      const res = await availability(customer, defaultQuery()).expect(200);

      expect((res.body as AvailabilityBody).slots.map((s) => s.startLocal)).toContain('09:00');
    });

    it.each([BookingStatus.WAITING, BookingStatus.IN_PROGRESS, BookingStatus.DONE])(
      'treats a %s booking as occupying the slot',
      async (status) => {
        await book('2027-06-16T02:00:00Z', '2027-06-16T02:30:00Z', status);

        const res = await availability(customer, defaultQuery()).expect(200);

        expect((res.body as AvailabilityBody).slots.map((s) => s.startLocal)).not.toContain(
          '09:00',
        );
      },
    );

    it('empties the day when it is fully booked', async () => {
      await book('2027-06-16T02:00:00Z', '2027-06-16T05:00:00Z');

      const res = await availability(customer, defaultQuery()).expect(200);
      const body = res.body as AvailabilityBody;

      expect(body.open).toBe(true);
      expect(body.slots).toEqual([]);
    });

    it('ignores a booking belonging to a different staff member', async () => {
      const other = await http()
        .post(`/shops/${shopId}/staff`)
        .set(auth(owner))
        .send({ name: 'Budi' })
        .expect(201);
      const otherStaffId = (other.body as Identified).id;

      await prisma.booking.create({
        data: {
          shopId,
          serviceId,
          staffId: otherStaffId,
          customerId,
          startTime: new Date('2027-06-16T02:00:00Z'),
          endTime: new Date('2027-06-16T02:30:00Z'),
        },
      });

      const res = await availability(customer, defaultQuery()).expect(200);

      expect((res.body as AvailabilityBody).slots.map((s) => s.startLocal)).toContain('09:00');
    });
  });

  describe('service duration', () => {
    it('offers fewer starts for a longer service', async () => {
      const long = await http()
        .post(`/shops/${shopId}/services`)
        .set(auth(owner))
        .send({ name: 'Creambath', durationMinutes: 120, price: 150000 })
        .expect(201);

      const res = await availability(customer, {
        ...defaultQuery(),
        serviceId: (long.body as Identified).id,
      }).expect(200);

      // 09:00–12:00 with a 2-hour service: 09:00, 09:15 … 10:00.
      const locals = (res.body as AvailabilityBody).slots.map((slot) => slot.startLocal);
      expect(locals.at(-1)).toBe('10:00');
    });

    it('offers nothing when the service cannot fit the day', async () => {
      const huge = await http()
        .post(`/shops/${shopId}/services`)
        .set(auth(owner))
        .send({ name: 'Full Day Treatment', durationMinutes: 300, price: 500000 })
        .expect(201);

      const res = await availability(customer, {
        ...defaultQuery(),
        serviceId: (huge.body as Identified).id,
      }).expect(200);

      expect((res.body as AvailabilityBody).slots).toEqual([]);
    });
  });

  describe('slots already in the past', () => {
    // The clock is pinned by calling the service directly, so this asserts real
    // behaviour instead of whatever time the suite happens to run at.
    const at = (iso: string) =>
      app.get(AvailabilityService).find(shopId, { serviceId, staffId, date: DATE }, new Date(iso));

    it('drops starts that have already passed', async () => {
      // 10:07 Jakarta on the day itself.
      const result = await at('2027-06-16T03:07:00Z');

      expect(result.slots.map((slot) => slot.startLocal)).toEqual([
        '10:15',
        '10:30',
        '10:45',
        '11:00',
        '11:15',
        '11:30',
      ]);
    });

    it('drops a slot starting exactly now', async () => {
      const result = await at('2027-06-16T03:00:00Z');

      expect(result.slots.map((slot) => slot.startLocal)[0]).toBe('10:15');
    });

    it('keeps the whole day when now is before opening', async () => {
      const result = await at('2027-06-16T00:00:00Z');

      expect(result.slots).toHaveLength(11);
    });

    it('empties a day that has finished', async () => {
      const result = await at('2027-06-16T12:00:00Z');

      expect(result.open).toBe(true);
      expect(result.slots).toEqual([]);
    });
  });

  describe('validation and tenancy', () => {
    it('rejects a malformed date', async () => {
      await availability(customer, { ...defaultQuery(), date: '16-06-2027' }).expect(400);
    });

    it('rejects a date that does not exist', async () => {
      await availability(customer, { ...defaultQuery(), date: '2027-02-30' }).expect(400);
    });

    it('rejects a missing parameter', async () => {
      await http()
        .get(`/shops/${shopId}/availability`)
        .set(auth(customer))
        .query({ serviceId, date: DATE })
        .expect(400);
    });

    it('rejects an unknown query parameter', async () => {
      await availability(customer, { ...defaultQuery(), sneaky: 'yes' }).expect(400);
    });

    it('requires authentication', async () => {
      await http().get(`/shops/${shopId}/availability`).query(defaultQuery()).expect(401);
    });

    it('refuses a service belonging to another shop', async () => {
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
      const otherShopId = (otherShop.body as Identified).id;

      const foreignService = await http()
        .post(`/shops/${otherShopId}/services`)
        .set(auth(otherToken))
        .send({ name: 'Cukur', durationMinutes: 30, price: 30000 })
        .expect(201);

      // A real service id, but not one belonging to this shop.
      await availability(customer, {
        ...defaultQuery(),
        serviceId: (foreignService.body as Identified).id,
      }).expect(404);
    });

    it('refuses an inactive service', async () => {
      const temp = await http()
        .post(`/shops/${shopId}/services`)
        .set(auth(owner))
        .send({ name: 'Retired', durationMinutes: 30, price: 30000 })
        .expect(201);
      const tempId = (temp.body as Identified).id;

      await http().delete(`/shops/${shopId}/services/${tempId}`).set(auth(owner)).expect(200);

      await availability(customer, { ...defaultQuery(), serviceId: tempId }).expect(404);
    });

    it('refuses an unknown shop', async () => {
      await http()
        .get('/shops/00000000-0000-4000-8000-000000000000/availability')
        .set(auth(customer))
        .query(defaultQuery())
        .expect(404);
    });
  });
});
