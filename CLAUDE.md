# CLAUDE.md — MauApa?

Instructions for Claude Code. Read `PRD.md` for the full spec and `plan.md` for
the build order. Keep this file lean.

## What we're building

A backend-focused, multi-tenant booking + queue API for small service businesses
(barbershop/salon). The star of this project is backend quality — concurrency,
multi-tenancy, real-time — not the UI. See PRD.md.

## Tech stack (do not swap without asking)

- NestJS (TypeScript, strict)
- PostgreSQL + Prisma
- Redis (rate limiting + real-time pub/sub)
- JWT (access + refresh) + RBAC (owner/staff/customer)
- Socket.IO for the real-time queue
- Swagger/OpenAPI for docs
- Jest for tests
- Docker + GitHub Actions for CI/CD

## Working rules

- **Plan before coding.** For any non-trivial task, write the plan first and wait
  for confirmation. If you can't state the plan clearly, don't code it yet.
- **Build in vertical slices.** One feature end-to-end before the next. Follow the
  phases in `plan.md`; do not jump ahead.
- **Keep it simple.** Simplest solution that works. No premature abstraction.
- **File size limit.** No file over ~300 lines; split before it grows past that.
- **Write tests** — especially for the booking/concurrency logic.
- **Explain non-obvious trade-offs** briefly.

## The two things that must be correct (this is why the project exists)

1. **Concurrency-safe booking.** Two simultaneous requests for the same staff and
   overlapping time must NOT both succeed. Prevent this at the database level:
   prefer a PostgreSQL EXCLUDE constraint on a tstzrange (GiST), or a transaction
   with row locking (SELECT ... FOR UPDATE) plus an overlap check. Write an
   integration test that fires two concurrent booking requests and asserts exactly
   one succeeds.
2. **Multi-tenant isolation.** Every query is scoped by `shop_id`, and ownership is
   verified on every mutation. An owner must never read or modify another shop's
   data. Never trust a `shop_id`/`booking_id` from the client without checking it
   belongs to the authenticated user.

## Security

- Keep all secrets server-side; document env vars in `.env.example`.
- Hash passwords (bcrypt/argon2). Never log tokens or password hashes.
- Validate and sanitize all input (class-validator / DTOs).
- Rate-limit auth and booking endpoints.

## Commands

- `npm run start:dev` — local dev
- `npm run build` — production build
- `npm run test` / `npm run test:e2e` — tests
- `npm run lint` — lint
- `npx prisma migrate dev` — run migrations

## Conventions

- TypeScript strict mode on.
- Group code by feature module (auth, shops, services, staff, bookings, queue).
- Env vars in `.env` (never commit); document new ones in `.env.example`.
- Do not include a Co-Authored-By line or "Generated with" line in commit messages.
