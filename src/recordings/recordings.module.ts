import { Module } from '@nestjs/common';
import { RecordingsRepository } from './recordings.repository';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';
import { SpeechModule } from '../speech/speech.module';

@Module({
  imports: [AiModule, StorageModule, SpeechModule],
  controllers: [RecordingsController],
  providers: [RecordingsRepository, RecordingsService],
  exports: [RecordingsService, RecordingsRepository],
})
export class RecordingsModule {}
