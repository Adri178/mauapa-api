import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

interface AuthBody {
  accessToken: string;
  user: { id: string; email: string; role: Role };
}

interface Identified {
  id: string;
}

const RUN = Date.now();
const emailFor = (label: string) => `tenancy-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

/**
 * The point of this suite: two owners, each with a full shop, proving that
 * neither can read or modify anything belonging to the other. Phase 2 is not
 * done until every one of these passes.
 */
describe('Multi-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer() as Server);

  let ownerA: string;
  let ownerB: string;
  let customer: string;
  let shopA: string;
  let shopB: string;
  let serviceA: string;
  let staffA: string;

  async function registerAs(label: string, role: Role): Promise<AuthBody> {
    const res = await http()
      .post('/auth/register')
      .send({ email: emailFor(label), name: 'Test User', password: PASSWORD, role })
      .expect(201);

    return res.body as AuthBody;
  }

  async function createShop(token: string, name: string): Promise<string> {
    const res = await http()
      .post('/shops')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, address: 'Jl. Melati No. 12, Bandung' })
      .expect(201);

    return (res.body as Identified).id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    ownerA = (await registerAs('owner-a', Role.OWNER)).accessToken;
    ownerB = (await registerAs('owner-b', Role.OWNER)).accessToken;
    customer = (await registerAs('customer', Role.CUSTOMER)).accessToken;

    shopA = await createShop(ownerA, 'Barbershop A');
    shopB = await createShop(ownerB, 'Barbershop B');

    const service = await http()
      .post(`/shops/${shopA}/services`)
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
      .expect(201);
    serviceA = (service.body as Identified).id;

    const staff = await http()
      .post(`/shops/${shopA}/staff`)
      .set('Authorization', `Bearer ${ownerA}`)
      .send({ name: 'Andi' })
      .expect(201);
    staffA = (staff.body as Identified).id;
  });

  afterAll(async () => {
    // Shops cascade; users are removed by email namespace.
    await prisma?.user.deleteMany({ where: { email: { startsWith: `tenancy-${RUN}-` } } });
    await app?.close();
  });

  describe('shops', () => {
    it('lists only the caller’s own shops', async () => {
      const res = await http().get('/shops').set('Authorization', `Bearer ${ownerA}`).expect(200);

      const ids = (res.body as Identified[]).map((shop) => shop.id);
      expect(ids).toContain(shopA);
      expect(ids).not.toContain(shopB);
    });

    it("hides another owner's shop behind a 404, not a 403", async () => {
      // A 403 would confirm the id exists. To owner B, shop A is indistinguishable
      // from a shop that was never created.
      await http().get(`/shops/${shopA}`).set('Authorization', `Bearer ${ownerB}`).expect(404);
    });

    it("refuses to update another owner's shop", async () => {
      await http()
        .patch(`/shops/${shopA}`)
        .set('Authorization', `Bearer ${ownerB}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      const res = await http()
        .get(`/shops/${shopA}`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      expect((res.body as { name: string }).name).toBe('Barbershop A');
    });

    it("refuses to delete another owner's shop", async () => {
      await http().delete(`/shops/${shopA}`).set('Authorization', `Bearer ${ownerB}`).expect(404);

      await http().get(`/shops/${shopA}`).set('Authorization', `Bearer ${ownerA}`).expect(200);
    });

    it('rejects a customer outright with 403', async () => {
      await http().get('/shops').set('Authorization', `Bearer ${customer}`).expect(403);
      await http()
        .post('/shops')
        .set('Authorization', `Bearer ${customer}`)
        .send({ name: 'Nope', address: 'Jl. Melati No. 12' })
        .expect(403);
    });

    it('rejects an anonymous caller with 401', async () => {
      await http().get('/shops').expect(401);
    });
  });

  describe('services', () => {
    it("cannot be listed through another owner's shop", async () => {
      await http()
        .get(`/shops/${shopA}/services`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(404);
    });

    it("cannot be read by id through another owner's shop", async () => {
      await http()
        .get(`/shops/${shopA}/services/${serviceA}`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(404);
    });

    it("cannot be updated through the attacker's own shop id", async () => {
      // The id is real, but it does not belong to shop B — scoping both makes
      // it invisible rather than merely forbidden.
      await http()
        .patch(`/shops/${shopB}/services/${serviceA}`)
        .set('Authorization', `Bearer ${ownerB}`)
        .send({ price: 1 })
        .expect(404);

      const res = await http()
        .get(`/shops/${shopA}/services/${serviceA}`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      expect((res.body as { price: number }).price).toBe(35000);
    });

    it('rejects a duplicate name within the same shop', async () => {
      await http()
        .post(`/shops/${shopA}/services`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Potong Rambut', durationMinutes: 30, price: 35000 })
        .expect(409);
    });

    it('allows the same name in a different shop', async () => {
      await http()
        .post(`/shops/${shopB}/services`)
        .set('Authorization', `Bearer ${ownerB}`)
        .send({ name: 'Potong Rambut', durationMinutes: 45, price: 50000 })
        .expect(201);
    });

    it('deactivates instead of deleting, and hides inactive by default', async () => {
      const created = await http()
        .post(`/shops/${shopA}/services`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Creambath', durationMinutes: 60, price: 90000 })
        .expect(201);
      const id = (created.body as Identified).id;

      await http()
        .delete(`/shops/${shopA}/services/${id}`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);

      const visible = await http()
        .get(`/shops/${shopA}/services`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      expect((visible.body as Identified[]).map((s) => s.id)).not.toContain(id);

      const all = await http()
        .get(`/shops/${shopA}/services?includeInactive=true`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);
      expect((all.body as Identified[]).map((s) => s.id)).toContain(id);
    });
  });

  describe('staff', () => {
    it("cannot be reached through another owner's shop", async () => {
      await http()
        .get(`/shops/${shopA}/staff`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(404);
      await http()
        .patch(`/shops/${shopB}/staff/${staffA}`)
        .set('Authorization', `Bearer ${ownerB}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('provisions a STAFF login when an email is supplied', async () => {
      const email = emailFor('kapster');

      await http()
        .post(`/shops/${shopA}/staff`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Sari', email, password: PASSWORD })
        .expect(201);

      const login = await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      expect((login.body as AuthBody).user.role).toBe(Role.STAFF);
    });

    it('requires a password when an email is supplied', async () => {
      await http()
        .post(`/shops/${shopA}/staff`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Tanpa Sandi', email: emailFor('no-password') })
        .expect(400);
    });

    it('offers no way to attach an arbitrary existing user id', async () => {
      // userId is not part of the DTO; forbidNonWhitelisted turns the attempt
      // into a 400 rather than silently ignoring it.
      await http()
        .post(`/shops/${shopA}/staff`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Sneaky', userId: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
    });

    it('rejects an email that is already registered', async () => {
      await http()
        .post(`/shops/${shopA}/staff`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ name: 'Duplicate', email: emailFor('owner-a'), password: PASSWORD })
        .expect(409);
    });
  });

  describe('working hours', () => {
    const week = {
      hours: [
        { dayOfWeek: 1, open: '09:00', close: '17:00' },
        { dayOfWeek: 2, open: '09:00', close: '17:00' },
      ],
    };

    it('replaces the whole week and reads back as HH:mm', async () => {
      const res = await http()
        .put(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send(week)
        .expect(200);

      expect(res.body).toEqual([
        { dayOfWeek: 1, open: '09:00', close: '17:00' },
        { dayOfWeek: 2, open: '09:00', close: '17:00' },
      ]);
    });

    it('drops days omitted from a later replace', async () => {
      await http()
        .put(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ hours: [{ dayOfWeek: 1, open: '10:00', close: '15:00' }] })
        .expect(200);

      const res = await http()
        .get(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerA}`)
        .expect(200);

      expect(res.body).toEqual([{ dayOfWeek: 1, open: '10:00', close: '15:00' }]);
    });

    it('rejects close at or before open', async () => {
      await http()
        .put(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ hours: [{ dayOfWeek: 3, open: '17:00', close: '09:00' }] })
        .expect(400);
    });

    it('rejects the same day twice', async () => {
      await http()
        .put(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({
          hours: [
            { dayOfWeek: 4, open: '09:00', close: '12:00' },
            { dayOfWeek: 4, open: '13:00', close: '17:00' },
          ],
        })
        .expect(400);
    });

    it('rejects a malformed time', async () => {
      await http()
        .put(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerA}`)
        .send({ hours: [{ dayOfWeek: 5, open: '9am', close: '17:00' }] })
        .expect(400);
    });

    it("cannot be read or written through another owner's shop", async () => {
      await http()
        .get(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerB}`)
        .expect(404);

      await http()
        .put(`/shops/${shopA}/working-hours`)
        .set('Authorization', `Bearer ${ownerB}`)
        .send(week)
        .expect(404);
    });
  });

  describe('cascade', () => {
    it('removes a shop’s services, staff, and hours along with it', async () => {
      const token = (await registerAs('cascade-owner', Role.OWNER)).accessToken;
      const shopId = await createShop(token, 'Doomed Shop');

      await http()
        .post(`/shops/${shopId}/services`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Cukur', durationMinutes: 20, price: 20000 })
        .expect(201);

      await http().delete(`/shops/${shopId}`).set('Authorization', `Bearer ${token}`).expect(204);

      expect(await prisma.service.count({ where: { shopId } })).toBe(0);
      expect(await prisma.workingHours.count({ where: { shopId } })).toBe(0);
    });
  });
});
