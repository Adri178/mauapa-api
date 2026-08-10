import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      // Prisma's raw init error dumps its minified bundle into the log; the
      // actionable part is one line, so surface that and drop the rest.
      const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
      this.logger.error(
        `Cannot reach the database (${reason}). Is it running? Try: docker compose up -d`,
      );
      throw new Error(`Database connection failed: ${reason}`);
    }
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
