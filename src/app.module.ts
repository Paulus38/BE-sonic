import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RecordingsModule } from './recordings/recordings.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { AiModule } from './ai/ai.module';
import { SpeechModule } from './speech/speech.module';
import { LiveModule } from './live/live.module';
import { StorageModule } from './storage/storage.module';
import { FirebaseModule } from './firebase/firebase.module';
import { FirestoreModule } from './firestore/firestore.module';
import { AuditModule } from './audit/audit.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const level = config.get<string>('app.logLevel') ?? 'info';
        const logHttp = config.get<boolean>('app.logHttp') !== false;
        const isProd =
          (config.get<string>('app.nodeEnv') ?? 'development') === 'production';
        return {
          pinoHttp: {
            level,
            autoLogging: logHttp
              ? {
                  ignore: (req: { url?: string }) =>
                    (req.url ?? '').startsWith('/api/v1/health'),
                }
              : false,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.token',
                'req.body.accessToken',
              ],
              remove: true,
            },
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true },
                },
            serializers: {
              req(req: {
                id?: string;
                method?: string;
                url?: string;
              }) {
                return {
                  id: req.id,
                  method: req.method,
                  url: req.url,
                };
              },
              res(res: { statusCode?: number }) {
                return { statusCode: res.statusCode };
              },
            },
            customProps: (req: unknown) => {
              const user = (
                req as { user?: { id?: string; email?: string } }
              ).user;
              return { userId: user?.id };
            },
          },
        };
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('app.throttleTtlMs') ?? 60000,
          limit: config.get<number>('app.throttleLimit') ?? 120,
        },
      ],
    }),
    AuthModule,
    UsersModule,
    RecordingsModule,
    DictionaryModule,
    AiModule,
    SpeechModule,
    LiveModule,
    FirebaseModule,
    FirestoreModule,
    StorageModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
