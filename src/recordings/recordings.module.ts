import { Module } from '@nestjs/common';
import { RecordingsRepository } from './recordings.repository';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [AiModule, StorageModule],
  controllers: [RecordingsController],
  providers: [RecordingsRepository, RecordingsService],
  exports: [RecordingsService, RecordingsRepository],
})
export class RecordingsModule {}
