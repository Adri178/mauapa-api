import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './common/http-exception.filter';

/**
 * Everything that turns a bare Nest app into *this* API.
 *
 * Shared by main.ts and the e2e suites so the two cannot drift: a test that
 * builds its own app with slightly different pipes is testing something the
 * deployment never runs. It is also what lets a test assert on the published
 * OpenAPI document.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Rejecting unknown fields rather than stripping them: a client sending
      // `endTime` or `role` should be told it is being ignored, not left to
      // assume it worked.
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  setupSwagger(app);
}

function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('MauApa? API')
    .setDescription(
      [
        'Booking and queue API for small service businesses (barbershop, salon).',
        '',
        '**Double-booking** is prevented by a partial GiST EXCLUDE constraint in Postgres,',
        'not by application code — two concurrent requests for the same slot always resolve',
        'to one 201 and one 409.',
        '',
        '**Multi-tenancy**: everything under `/shops/{shopId}` is scoped to that shop, and a',
        'shop belonging to another owner answers 404 rather than 403, so ids cannot be probed.',
        '',
        '**Live queue**: connect a Socket.IO client to the `/queue` namespace with the access',
        'token in `auth.token`, send `queue.watch` with `{ shopId, date }`, and receive',
        '`queue.updated` whenever a booking on that shop changes.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .addTag('auth', 'Registration, login, and token rotation')
    .addTag('shops', 'Shops owned by the caller')
    .addTag('services', 'What a shop sells')
    .addTag('staff', 'Who does the work')
    .addTag('working-hours', 'When a shop is open')
    .addTag('availability', 'Free slots for a service, staff member, and date')
    .addTag('bookings', 'Making and advancing bookings')
    .addTag('queue', "A shop's live queue")
    .addTag('health', 'Liveness and database connectivity')
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    swaggerOptions: { persistAuthorization: true },
  });
}

/**
 * Tells Express to read the client address from the proxy headers.
 *
 * Rate limiting counts the caller. Behind a load balancer every request appears
 * to come from the proxy, so without this one busy shop would exhaust the limit
 * for everyone.
 */
export function trustProxy(app: INestApplication, value: number | boolean): void {
  const express = app.getHttpAdapter().getInstance() as {
    set: (setting: string, value: unknown) => void;
  };
  express.set('trust proxy', value);
}
