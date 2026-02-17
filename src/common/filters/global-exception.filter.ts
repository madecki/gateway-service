import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayErrorResponse } from '../interfaces';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const correlationId = request.correlationId || 'unknown';

    let status: number;
    let message: string;
    let code: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message?.toString() || exception.message;
      code = this.getErrorCode(status);
    } else if (this.isUpstreamError(exception)) {
      status = HttpStatus.BAD_GATEWAY;
      message = 'Upstream service unavailable';
      code = 'UPSTREAM_ERROR';

      this.logger.error(
        {
          correlationId,
          error: exception instanceof Error ? exception.message : 'Unknown upstream error',
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'Upstream service error',
      );
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      code = 'INTERNAL_ERROR';

      this.logger.error(
        {
          correlationId,
          error: exception instanceof Error ? exception.message : 'Unknown error',
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'Unhandled exception',
      );
    }

    const errorResponse: GatewayErrorResponse = {
      error: {
        code,
        message,
        correlationId,
      },
    };

    response.status(status).send(errorResponse);
  }

  private isUpstreamError(exception: unknown): boolean {
    if (exception instanceof Error) {
      const errorCodes = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'];
      return errorCodes.some(
        (code) =>
          exception.message.includes(code) || (exception as NodeJS.ErrnoException).code === code,
      );
    }
    return false;
  }

  private getErrorCode(status: number): string {
    const codeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.REQUEST_TIMEOUT]: 'REQUEST_TIMEOUT',
      [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
      [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMIT_EXCEEDED',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
      [HttpStatus.BAD_GATEWAY]: 'UPSTREAM_ERROR',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
      [HttpStatus.GATEWAY_TIMEOUT]: 'GATEWAY_TIMEOUT',
    };

    return codeMap[status] || 'UNKNOWN_ERROR';
  }
}
