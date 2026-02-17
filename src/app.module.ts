import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'http';
import { AppConfigModule, AppConfigService } from './config';
import { GatewayModule } from './gateway/gateway.module';
import { CORRELATION_ID_HEADER } from './common/constants';

interface ExtendedIncomingMessage extends IncomingMessage {
  correlationId?: string;
}

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (configService: AppConfigService) => ({
        pinoHttp: {
          level: configService.logLevel,
          transport: configService.isDevelopment
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:standard',
                },
              }
            : undefined,
          customProps: (req: ExtendedIncomingMessage, _res: ServerResponse) => ({
            correlationId:
              req.correlationId ||
              (req.headers && (req.headers[CORRELATION_ID_HEADER] as string)) ||
              'unknown',
          }),
          serializers: {
            req: (req: ExtendedIncomingMessage) => ({
              method: req.method,
              url: req.url,
              correlationId:
                req.correlationId ||
                (req.headers && (req.headers[CORRELATION_ID_HEADER] as string)) ||
                'unknown',
            }),
            res: (res: { statusCode: number }) => ({
              statusCode: res.statusCode,
            }),
          },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
      }),
    }),
    GatewayModule,
  ],
})
export class AppModule {}
