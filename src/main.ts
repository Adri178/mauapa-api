import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { trustProxy } from './app.setup';
import { configureApp } from './app.setup';
import { RedisIoAdapter } from './queue/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // A single static page for watching the queue move. Swagger documents every
  // endpoint but cannot show a websocket, and that is the one thing worth
  // seeing with your own eyes.
  app.useStaticAssets(join(process.cwd(), 'public'), { prefix: '/demo' });

  // Behind a load balancer the client address arrives in a header; rate
  // limiting counts the caller, not the proxy in front of them.
  trustProxy(app, 1);

  configureApp(app);

  const config = app.get(ConfigService);

  // Broadcasts have to survive more than one instance; see RedisIoAdapter.
  const redisAdapter = new RedisIoAdapter(app);
  await redisAdapter.connect(config.getOrThrow<string>('REDIS_URL'));
  app.useWebSocketAdapter(redisAdapter);

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);

  new Logger('Bootstrap').log(
    `API on http://localhost:${port} — Swagger at /docs, live queue at /queue`,
  );
}

void bootstrap();
