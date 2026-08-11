import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './queue/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = app.get(ConfigService);

  // Broadcasts have to survive more than one instance; see RedisIoAdapter.
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connect(config.getOrThrow<string>('REDIS_URL'));
  app.useWebSocketAdapter(redisAdapter);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MauApa? API')
    .setDescription('Booking & queue API for small service businesses (barbershop/salon)')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  new Logger('Bootstrap').log(
    `API on http://localhost:${port} — Swagger at /docs, live queue at /queue`,
  );
}

void bootstrap();
