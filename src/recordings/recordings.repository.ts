import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recording } from './recording.entity';
import { TranscriptSegment } from './transcript-segment.entity';
import { RecordingStatus } from '../common/enums';

@Injectable()
export class RecordingsRepository {
  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    @InjectRepository(TranscriptSegment)
    private readonly segmentRepo: Repository<TranscriptSegment>,
  ) {}

  create(data: Partial<Recording>): Recording {
    return this.recordingRepo.create(data);
  }

  save(recording: Recording): Promise<Recording> {
    return this.recordingRepo.save(recording);
  }

  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<Recording | null> {
    return this.recordingRepo.findOne({
      where: { id, userId },
      relations: ['transcript'],
      order: { transcript: { seq: 'ASC' } },
    });
  }

  async findPaginated(userId: string, page: number, limit: number) {
    const [items, total] = await this.recordingRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  findStuckRecording(userId: string) {
    return this.recordingRepo.find({
      where: { userId, status: RecordingStatus.RECORDING },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  softDelete(id: string, userId: string) {
    return this.recordingRepo.softDelete({ id, userId });
  }

  createSegment(data: Partial<TranscriptSegment>): TranscriptSegment {
    return this.segmentRepo.create(data);
  }

  saveSegment(segment: TranscriptSegment): Promise<TranscriptSegment> {
    return this.segmentRepo.save(segment);
  }

  async updateSegmentTranslation(
    segmentId: string,
    recordingId: string,
    translation: string,
  ) {
    await this.segmentRepo.update(
      { id: segmentId, recordingId },
      { translation },
    );
  }

  async replaceTranscript(
    recordingId: string,
    segments: Partial<TranscriptSegment>[],
  ): Promise<TranscriptSegment[]> {
    await this.segmentRepo.delete({ recordingId });
    const entities = segments.map((s, idx) =>
      this.segmentRepo.create({ ...s, recordingId, seq: s.seq ?? idx }),
    );
    return this.segmentRepo.save(entities);
  }

  countByStatus(userId: string, status: RecordingStatus) {
    return this.recordingRepo.count({ where: { userId, status } });
  }
}
