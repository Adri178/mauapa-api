import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export interface ErrorBody {
  statusCode: number;
  error: string;
  /** Always an array, so a client never has to branch on string-or-array. */
  message: string[];
  path: string;
  timestamp: string;
  /** Present on 5xx, so a user can quote it and the log can be found. */
  requestId?: string;
}

/**
 * One shape for every error the API can produce.
 *
 * Nest's defaults are close but not uniform: validation failures return
 * `message` as an array while everything else returns a string, and anything
 * unhandled leaks whatever the thrower wrote. Clients end up parsing two or
 * three shapes. This normalises all of them.
 *
 * It also stops unexpected errors from leaking internals. A Prisma error
 * message names tables and columns; a stack trace names paths. Those go to the
 * log with an id attached, and the client gets that id and nothing else.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Websocket and other transports have no HTTP response to write to.
    if (host.getType() !== 'http') {
      throw exception;
    }

    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const body = this.toBody(exception, request.url);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${body.statusCode} [${body.requestId}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, path: string): ErrorBody {
    const timestamp = new Date().toISOString();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      return {
        statusCode: status,
        error: nameFor(status),
        message: messagesFrom(payload, exception.message),
        path,
        timestamp,
      };
    }

    // A Prisma failure that reached here was not one the service expected;
    // its message describes the schema, so it must not be sent onward.
    const isKnownDatabaseError =
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientValidationError;

    const requestId = randomUUID();

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: nameFor(HttpStatus.INTERNAL_SERVER_ERROR),
      message: [
        isKnownDatabaseError
          ? 'The request could not be completed'
          : 'An unexpected error occurred',
      ],
      path,
      timestamp,
      requestId,
    };
  }
}

/** Pulls the human-readable part out of whatever Nest put in the exception. */
function messagesFrom(payload: string | object, fallback: string): string[] {
  if (typeof payload === 'string') {
    return [payload];
  }

  const message = (payload as { message?: unknown }).message;

  if (Array.isArray(message)) {
    return message.map(String);
  }

  if (typeof message === 'string') {
    return [message];
  }

  return [fallback];
}

const STATUS_NAMES = new Map<number, string>(
  Object.entries(HttpStatus)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, status]) => [status, name.replace(/_/g, ' ').toLowerCase()]),
);

function nameFor(status: number): string {
  const name = STATUS_NAMES.get(status) ?? 'error';
  return name.replace(/\b\w/g, (character) => character.toUpperCase());
}
