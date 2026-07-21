import { Module } from '@nestjs/common';
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
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
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
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
