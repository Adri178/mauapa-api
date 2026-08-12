import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

interface Identified {
  id: string;
}

interface ShopCard {
  id: string;
  name: string;
  address: string;
  timezone: string;
  openNow: boolean;
  serviceCount: number;
  staffCount: number;
}

interface ShopDetail extends ShopCard {
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>;
  staff: Array<{ id: string; name: string }>;
  workingHours: Array<{ dayOfWeek: number; open: string; close: string }>;
}

interface Page<T> {
  data: T[];
  meta: { total: number; totalPages: number; hasNextPage: boolean };
}

const RUN = Date.now();
const emailFor = (label: string) => `catalog-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';
/** Unique enough that the search tests cannot match another run's rows. */
const MARK = `Kataloguji${RUN}`;

describe('Public catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer() as Server);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let owner: string;
  let ownerId: string;
  let shopId: string;
  let activeServiceId: string;
  let retiredServiceId: string;
  let activeStaffId: string;
  let retiredStaffId: string;
  let staffUserId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const registered = await http()
      .post('/auth/register')
      .send({ email: emailFor('owner'), name: 'Pemilik', password: PASSWORD, role: Role.OWNER })
      .expect(201);
    owner = (registered.body as { accessToken: string }).accessToken;
    ownerId = (registered.body as { user: Identified }).user.id;

    const shop = await http()
      .post('/shops')
      .set(auth(owner))
      .send({
        name: `${MARK} Barbershop`,
        address: `Jl. ${MARK} No. 12, Bandung`,
        timezone: 'Asia/Jakarta',
      })
      .expect(201);
    shopId = (shop.body as Identified).id;

    const service = await http()
      .post(`/shops/${shopId}/services`)
      .set(auth(owner))
      .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
      .expect(201);
    activeServiceId = (service.body as Identified).id;

    const retiredService = await http()
      .post(`/shops/${shopId}/services`)
      .set(auth(owner))
      .send({ name: 'Layanan Pensiun', durationMinutes: 30, price: 1 })
      .expect(201);
    retiredServiceId = (retiredService.body as Identified).id;
    await http()
      .delete(`/shops/${shopId}/services/${retiredServiceId}`)
      .set(auth(owner))
      .expect(200);

    // Staff with a login, so the response can be checked for a leaked userId.
    const staff = await http()
      .post(`/shops/${shopId}/staff`)
      .set(auth(owner))
      .send({ name: 'Andi', email: emailFor('kapster'), password: PASSWORD })
      .expect(201);
    activeStaffId = (staff.body as Identified).id;
    staffUserId = (staff.body as { userId: string }).userId;

    const retiredStaff = await http()
      .post(`/shops/${shopId}/staff`)
      .set(auth(owner))
      .send({ name: 'Kapster Pensiun' })
      .expect(201);
    retiredStaffId = (retiredStaff.body as Identified).id;
    await http().delete(`/shops/${shopId}/staff/${retiredStaffId}`).set(auth(owner)).expect(200);

    await http()
      .put(`/shops/${shopId}/working-hours`)
      .set(auth(owner))
      .send({
        hours: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, open: '09:00', close: '20:00' })),
      })
      .expect(200);
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: `catalog-${RUN}-` } } });
    await app?.close();
  });

  describe('browsing without an account', () => {
    it('lists shops to a caller with no token at all', async () => {
      const res = await http().get('/public/shops').query({ q: MARK }).expect(200);
      const page = res.body as Page<ShopCard>;

      expect(page.meta.total).toBe(1);
      expect(page.data[0].name).toBe(`${MARK} Barbershop`);
    });

    it('opens one shop with everything the slot picker needs', async () => {
      const res = await http().get(`/public/shops/${shopId}`).expect(200);
      const shop = res.body as ShopDetail;

      expect(shop.services).toHaveLength(1);
      expect(shop.staff).toHaveLength(1);
      expect(shop.workingHours).toHaveLength(5);
      expect(shop.workingHours[0]).toEqual({ dayOfWeek: 1, open: '09:00', close: '20:00' });
    });

    it('searches on address as well as name', async () => {
      const res = await http()
        .get('/public/shops')
        .query({ q: `Jl. ${MARK}` })
        .expect(200);

      expect((res.body as Page<ShopCard>).meta.total).toBe(1);
    });

    it('ignores case', async () => {
      const res = await http().get('/public/shops').query({ q: MARK.toLowerCase() }).expect(200);

      expect((res.body as Page<ShopCard>).meta.total).toBe(1);
    });

    it('returns an empty page rather than an error when nothing matches', async () => {
      const res = await http().get('/public/shops').query({ q: 'tidakadaapapun-xyz' }).expect(200);
      const page = res.body as Page<ShopCard>;

      expect(page.data).toEqual([]);
      expect(page.meta.total).toBe(0);
    });

    it('paginates', async () => {
      const res = await http().get('/public/shops').query({ limit: 1 }).expect(200);

      expect((res.body as Page<ShopCard>).data).toHaveLength(1);
    });

    it('refuses a limit past the ceiling', async () => {
      await http().get('/public/shops').query({ limit: 500 }).expect(400);
    });

    it('answers 404 for a shop that does not exist', async () => {
      await http().get('/public/shops/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('answers 400 for an id that is not a uuid', async () => {
      await http().get('/public/shops/bukan-uuid').expect(400);
    });
  });

  describe('what the catalogue must never reveal', () => {
    it('does not name the owner', async () => {
      const list = await http().get('/public/shops').query({ q: MARK }).expect(200);
      const detail = await http().get(`/public/shops/${shopId}`).expect(200);

      for (const res of [list, detail]) {
        const serialised = JSON.stringify(res.body);
        expect(serialised).not.toContain(ownerId);
        expect(serialised).not.toContain('ownerId');
      }
    });

    it('does not expose which login belongs to which staff member', async () => {
      const res = await http().get(`/public/shops/${shopId}`).expect(200);
      const serialised = JSON.stringify(res.body);

      expect(serialised).not.toContain(staffUserId);
      expect(serialised).not.toContain('userId');
      expect(serialised).not.toContain(emailFor('kapster'));
    });

    it('hides deactivated services and staff', async () => {
      const res = await http().get(`/public/shops/${shopId}`).expect(200);
      const shop = res.body as ShopDetail;

      expect(shop.services.map((s) => s.id)).toEqual([activeServiceId]);
      expect(shop.staff.map((s) => s.id)).toEqual([activeStaffId]);
      expect(JSON.stringify(shop)).not.toContain(retiredServiceId);
      expect(JSON.stringify(shop)).not.toContain(retiredStaffId);
    });

    it('counts only what is active', async () => {
      const res = await http().get('/public/shops').query({ q: MARK }).expect(200);
      const card = (res.body as Page<ShopCard>).data[0];

      // Two services and two staff exist; one of each is retired.
      expect(card.serviceCount).toBe(1);
      expect(card.staffCount).toBe(1);
    });

    it('exposes no route into a shop’s bookings', async () => {
      // The catalogue is a read-only shopfront; the operational data stays
      // behind the authenticated, ownership-checked routes.
      await http().get(`/public/shops/${shopId}/bookings`).expect(404);
      await http().get(`/public/shops/${shopId}/queue`).expect(404);
    });

    it('still refuses the owner-only routes to an anonymous caller', async () => {
      await http().get(`/shops/${shopId}/services`).expect(401);
      await http().get(`/shops/${shopId}/staff`).expect(401);
      await http().get('/shops').expect(401);
    });
  });

  describe('openNow', () => {
    it('is a boolean judged against the shop’s own zone', async () => {
      const res = await http().get(`/public/shops/${shopId}`).expect(200);

      expect(typeof (res.body as ShopDetail).openNow).toBe('boolean');
    });

    it('is false for a shop with no opening hours', async () => {
      const bare = await http()
        .post('/shops')
        .set(auth(owner))
        .send({ name: `${MARK} Tanpa Jam`, address: 'Jl. Sepi No. 1', timezone: 'Asia/Jakarta' })
        .expect(201);

      const res = await http()
        .get(`/public/shops/${(bare.body as Identified).id}`)
        .expect(200);

      expect((res.body as ShopDetail).openNow).toBe(false);
    });
  });

  describe('what the customer flow needs downstream', () => {
    it('hands over ids that /availability accepts', async () => {
      const shop = (await http().get(`/public/shops/${shopId}`).expect(200)).body as ShopDetail;

      // The whole point of the catalogue: a customer who started with nothing
      // can now ask for slots.
      const customer = await http()
        .post('/auth/register')
        .send({
          email: emailFor('pelanggan'),
          name: 'Pelanggan',
          password: PASSWORD,
          role: Role.CUSTOMER,
        })
        .expect(201);

      await http()
        .get(`/shops/${shop.id}/availability`)
        .set(auth((customer.body as { accessToken: string }).accessToken))
        .query({
          serviceId: shop.services[0].id,
          staffId: shop.staff[0].id,
          date: '2027-06-16',
        })
        .expect(200);
    });
  });

  describe('profile and booking list enrichment', () => {
    it('tells a staff member which staff row they are', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: emailFor('kapster'), password: PASSWORD })
        .expect(200);

      expect((login.body as { user: { staffId: string } }).user.staffId).toBe(activeStaffId);

      const me = await http()
        .get('/auth/me')
        .set(auth((login.body as { accessToken: string }).accessToken))
        .expect(200);

      expect((me.body as { staffId: string }).staffId).toBe(activeStaffId);
    });

    it('leaves staffId null for anyone who is not staff', async () => {
      const me = await http().get('/auth/me').set(auth(owner)).expect(200);

      expect((me.body as { staffId: string | null }).staffId).toBeNull();
    });

    it('names the shop, service and staff in the customer’s own list', async () => {
      const customer = await http()
        .post('/auth/register')
        .send({
          email: emailFor('pemesan'),
          name: 'Pemesan',
          password: PASSWORD,
          role: Role.CUSTOMER,
        })
        .expect(201);
      const token = (customer.body as { accessToken: string }).accessToken;

      // Thursday 2027-06-17, inside the Monday–Friday window.
      await http()
        .post(`/shops/${shopId}/bookings`)
        .set(auth(token))
        .send({
          serviceId: activeServiceId,
          staffId: activeStaffId,
          startTime: '2027-06-17T02:00:00.000Z',
        })
        .expect(201);

      const res = await http().get('/bookings/me').set(auth(token)).expect(200);
      const [booking] = (res.body as Page<Record<string, unknown>>).data;

      expect(booking.shopName).toBe(`${MARK} Barbershop`);
      expect(booking.serviceName).toBe('Potong Rambut');
      expect(booking.staffName).toBe('Andi');
      expect(booking.shopTimezone).toBe('Asia/Jakarta');
      expect(booking.durationMinutes).toBe(30);
      expect(booking.price).toBe(35000);
    });
  });
});
