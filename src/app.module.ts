import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { User } from './users/user.entity';
import { Recording } from './recordings/recording.entity';
import { TranscriptSegment } from './recordings/transcript-segment.entity';
import { DictionaryItem } from './dictionary/dictionary-item.entity';

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
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbType = config.get<string>('app.db.type') ?? 'postgres';
        const common = {
          entities: [User, Recording, TranscriptSegment, DictionaryItem],
          synchronize: config.get<boolean>('app.db.synchronize'),
          logging: config.get<boolean>('app.db.logging'),
        };

        if (dbType === 'sqlite') {
          return {
            ...common,
            type: 'better-sqlite3' as const,
            database: config.get<string>('app.db.sqlitePath') ?? './data/sonic.sqlite',
          };
        }

        return {
          ...common,
          type: 'postgres' as const,
          host: config.get<string>('app.db.host'),
          port: config.get<number>('app.db.port'),
          username: config.get<string>('app.db.username'),
          password: config.get<string>('app.db.password'),
          database: config.get<string>('app.db.database'),
          ssl:
            config.get<string>('app.nodeEnv') === 'production'
              ? { rejectUnauthorized: true }
              : false,
        };
      },
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
