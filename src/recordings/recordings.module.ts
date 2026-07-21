import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recording } from './recording.entity';
import { TranscriptSegment } from './transcript-segment.entity';
import { RecordingsRepository } from './recordings.repository';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';
import { AiModule } from '../ai/ai.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recording, TranscriptSegment]),
    AiModule,
    StorageModule,
  ],
  controllers: [RecordingsController],
  providers: [RecordingsRepository, RecordingsService],
  exports: [RecordingsService, RecordingsRepository],
})
export class RecordingsModule {}
