# MauApa? — Booking & Queue API

Backend API for small service businesses (barbershop, salon) to take online
bookings and run a live queue. Multi-tenant, concurrency-safe, real-time.

The full case study — architecture diagram, how double-booking is prevented and
how that is tested — lands in Phase 7. See `PRD.md` and `plan.md`.

## Stack

NestJS · PostgreSQL + Prisma · Redis · JWT + RBAC · Socket.IO · Swagger · Jest · Docker

## Running locally

Requires Node 20+ and Docker.

```bash
cp .env.example .env
npm install
docker compose up -d      # Postgres 16 + Redis 7
npx prisma migrate dev
npm run start:dev
```

- API: http://localhost:3000
- Swagger: http://localhost:3000/docs
- Health: http://localhost:3000/health

## Scripts

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Dev server with watch mode |
| `npm run build` | Production build |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests |
| `npm run lint` | Lint (zero warnings allowed) |
| `npx prisma migrate dev` | Apply migrations |

## Build status

Following the phases in `plan.md`:

- [x] **Phase 0** — Setup (NestJS, Docker Compose, Prisma, Swagger, health check)
- [x] **Phase 1** — Auth + RBAC (argon2id, rotating refresh tokens, global guards)
- [x] **Phase 2** — Shops, services, staff, working hours (multi-tenant isolation)
- [x] **Phase 3** — Available slots (opening hours + duration + existing bookings)
- [ ] Phase 4 — Bookings with concurrency-safe overlap prevention
- [ ] Phase 5 — Real-time queue
- [ ] Phase 6 — Rate limiting, tests, docs
- [ ] Phase 7 — Deploy
