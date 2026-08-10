import { Controller, Get, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Role } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Roles } from '../src/auth/decorators/roles.decorator';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Phase 1 has no role-restricted business routes yet (shops arrive in Phase 2),
 * so these probes exercise the globally registered guards through the real
 * HTTP pipeline rather than by calling them directly.
 */
@Controller('probe')
class ProbeController {
  @Get('authenticated')
  authenticated(): { ok: boolean } {
    return { ok: true };
  }

  @Get('owner-only')
  @Roles(Role.OWNER)
  ownerOnly(): { ok: boolean } {
    return { ok: true };
  }
}

interface AuthBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: Role };
}

// Each run gets its own email namespace, so repeated runs never collide.
const RUN = Date.now();
const emailFor = (label: string) => `e2e-${RUN}-${label}@example.test`;
const PASSWORD = 'correct-horse-battery-staple';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer() as Server);

  const registerRequest = (body: Record<string, unknown>) =>
    http().post('/auth/register').send(body);

  const registerBody = (label: string, role: Role) => ({
    email: emailFor(label),
    name: 'Test User',
    password: PASSWORD,
    role,
  });

  async function register(label: string, role: Role = Role.CUSTOMER): Promise<AuthBody> {
    const res = await registerRequest(registerBody(label, role)).expect(201);
    return res.body as AuthBody;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { email: { startsWith: `e2e-${RUN}-` } } });
    await app?.close();
  });

  describe('POST /auth/register', () => {
    it('creates an account and returns a token pair', async () => {
      const body = await register('register-ok');

      expect(body.user).toMatchObject({ email: emailFor('register-ok'), role: Role.CUSTOMER });
      expect(typeof body.accessToken).toBe('string');
      expect(typeof body.refreshToken).toBe('string');
    });

    it('never leaks the password hash', async () => {
      const body = await register('no-leak');

      expect(JSON.stringify(body)).not.toContain('argon2');
      expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('rejects a duplicate email with 409', async () => {
      await register('dupe');
      await registerRequest(registerBody('dupe', Role.CUSTOMER)).expect(409);
    });

    it('refuses to create a STAFF account through public registration', async () => {
      await registerRequest(registerBody('staff-attempt', Role.STAFF)).expect(400);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await registerRequest({ ...registerBody('weak', Role.CUSTOMER), password: 'short' }).expect(
        400,
      );
    });

    it('rejects an unknown field instead of silently ignoring it', async () => {
      await registerRequest({
        ...registerBody('extra', Role.CUSTOMER),
        isAdmin: true,
      }).expect(400);
    });

    it('normalises email case so duplicates cannot slip through', async () => {
      await register('case');
      await registerRequest({
        ...registerBody('case', Role.CUSTOMER),
        email: emailFor('case').toUpperCase(),
      }).expect(409);
    });
  });

  describe('POST /auth/login', () => {
    const login = (email: string, password: string) =>
      http().post('/auth/login').send({ email, password });

    it('returns tokens for correct credentials', async () => {
      await register('login');

      const res = await login(emailFor('login'), PASSWORD).expect(200);

      expect(typeof (res.body as AuthBody).accessToken).toBe('string');
    });

    it('rejects a wrong password with 401', async () => {
      await register('badpass');

      await login(emailFor('badpass'), 'not-the-password').expect(401);
    });

    it('gives the same 401 for an unknown email, revealing nothing', async () => {
      const res = await login(emailFor('ghost'), PASSWORD).expect(401);

      expect((res.body as { message: string }).message).toBe('Invalid email or password');
    });
  });

  describe('guarded routes', () => {
    it('rejects a request with no token', async () => {
      await http().get('/probe/authenticated').expect(401);
    });

    it('rejects a malformed token', async () => {
      await http().get('/probe/authenticated').set('Authorization', 'Bearer not.a.jwt').expect(401);
    });

    it('accepts a valid access token', async () => {
      const { accessToken } = await register('guard-ok');

      await http()
        .get('/probe/authenticated')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('leaves /health public', async () => {
      await http().get('/health').expect(200);
    });
  });

  describe('role enforcement', () => {
    it('rejects a customer on an owner-only route with 403', async () => {
      const { accessToken } = await register('rbac-customer', Role.CUSTOMER);

      await http()
        .get('/probe/owner-only')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('allows an owner on an owner-only route', async () => {
      const { accessToken } = await register('rbac-owner', Role.OWNER);

      await http()
        .get('/probe/owner-only')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('answers 401 before 403 when no token is present', async () => {
      await http().get('/probe/owner-only').expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the authenticated user', async () => {
      const { accessToken, user } = await register('me');

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body).toEqual({
        id: user.id,
        email: emailFor('me'),
        name: 'Test User',
        role: Role.CUSTOMER,
      });
    });
  });

  describe('POST /auth/refresh', () => {
    const refresh = (refreshToken: string) => http().post('/auth/refresh').send({ refreshToken });

    it('rotates a refresh token into a fresh pair', async () => {
      const original = await register('refresh');

      const res = await refresh(original.refreshToken).expect(200);
      const rotated = res.body as AuthBody;

      expect(rotated.refreshToken).not.toBe(original.refreshToken);
      expect(typeof rotated.accessToken).toBe('string');
    });

    it('revokes every session when a used refresh token is replayed', async () => {
      const original = await register('replay');

      const res = await refresh(original.refreshToken).expect(200);
      const rotated = res.body as AuthBody;

      // Replaying a consumed token looks like theft, so every session dies —
      // including the one that legitimately replaced it.
      await refresh(original.refreshToken).expect(401);
      await refresh(rotated.refreshToken).expect(401);
    });

    it('rejects a refresh token signed with the wrong secret', async () => {
      // An access token is a well-formed JWT signed by the *other* secret.
      const { accessToken } = await register('wrong-secret');

      await refresh(accessToken).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token', async () => {
      const { refreshToken } = await register('logout');

      await http().post('/auth/logout').send({ refreshToken }).expect(204);
      await http().post('/auth/refresh').send({ refreshToken }).expect(401);
    });
  });
});
