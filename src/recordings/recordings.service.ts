import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RecordingsRepository } from './recordings.repository';
import {
  CreateRecordingDto,
  FinalizeRecordingDto,
} from './dto/recording.dto';
import { RecordingStatus } from '../common/enums';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { User } from '../users/user.entity';
import { MulterFile } from '../common/types/uploaded-file';

@Injectable()
export class RecordingsService {
  constructor(
    private readonly recordingsRepository: RecordingsRepository,
    private readonly aiService: AiService,
    private readonly storageService: StorageService,
  ) {}

  async create(user: User, dto: CreateRecordingDto) {
    const recording = this.recordingsRepository.create({
      userId: user.id,
      title: dto.title.trim(),
      category: dto.category ?? 'Học Tiếng Anh',
      status: RecordingStatus.RECORDING,
      participants: [
        {
          name: user.name,
          role: 'Người ghi âm',
          avatar: user.avatar ?? '',
        },
      ],
      tags: ['Live', dto.category ?? 'Học Tiếng Anh'],
    });
    return this.toDto(await this.recordingsRepository.save(recording));
  }

  async getOne(userId: string, id: string) {
    const recording = await this.recordingsRepository.findByIdForUser(
      id,
      userId,
    );
    if (!recording) {
      throw new NotFoundException('Recording not found');
    }
    return this.toDto(recording, true);
  }

  async finalize(userId: string, id: string, dto: FinalizeRecordingDto) {
    const recording = await this.requireOwned(userId, id);
    recording.status = RecordingStatus.PROCESSING;
    if (dto.title) recording.title = dto.title.trim();
    if (dto.category) recording.category = dto.category;
    recording.durationSec = Math.max(0, dto.durationSec || 0);
    recording.duration = this.formatDuration(recording.durationSec);

    if (dto.transcript?.length) {
      const segments = await this.recordingsRepository.replaceTranscript(
        recording.id,
        dto.transcript.map((line, idx) => ({
          time: line.time || this.formatDuration(idx),
          speaker: line.speaker || 'Speaker',
          text: line.text,
          translation: line.translation ?? null,
          tStartMs: line.tStartMs ?? idx * 1000,
          tEndMs: line.tEndMs ?? (idx + 1) * 1000,
          isFinal: true,
          seq: idx,
        })),
      );
      recording.transcript = segments;
      recording.isTranslated = segments.some((s) => !!s.translation);
      const fullText = segments.map((s) => s.text).join(' ');
      recording.summary =
        fullText.slice(0, 150) + (fullText.length > 150 ? '...' : '');
    } else if (!recording.summary) {
      // Keep any segments already saved during live session
      const existing = await this.recordingsRepository.findByIdForUser(
        id,
        userId,
      );
      if (existing?.transcript?.length) {
        recording.transcript = existing.transcript;
        recording.isTranslated = existing.transcript.some((s) => !!s.translation);
        const fullText = existing.transcript.map((s) => s.text).join(' ');
        recording.summary =
          fullText.slice(0, 150) + (fullText.length > 150 ? '...' : '');
      } else {
        recording.summary = 'Chưa có nội dung transcript.';
      }
    }

    if (dto.generateSummary !== false) {
      try {
        const source =
          recording.summary ||
          (recording.transcript || []).map((s) => s.text).join(' ');
        recording.aiSummary = await this.aiService.summarize(
          source,
          recording.title,
          recording.category,
          userId,
        );
      } catch {
        recording.aiSummary = this.aiService.buildLocalSummary(
          recording.summary || '',
          recording.title,
          recording.category,
        );
      }
    }

    recording.status = RecordingStatus.READY;
    if (!recording.tags?.length) {
      recording.tags = ['Live', recording.category];
    }
    const saved = await this.recordingsRepository.save(recording);
    const full = await this.recordingsRepository.findByIdForUser(
      saved.id,
      userId,
    );
    return this.toDto(full ?? saved, true);
  }

  async appendFinalSegment(
    userId: string,
    recordingId: string,
    data: {
      text: string;
      translation?: string;
      speaker?: string;
      tStartMs: number;
      tEndMs: number;
      seq: number;
    },
  ) {
    await this.requireOwned(userId, recordingId);
    const segment = this.recordingsRepository.createSegment({
      recordingId,
      text: data.text,
      translation: data.translation ?? null,
      speaker: data.speaker ?? 'Speaker',
      tStartMs: data.tStartMs,
      tEndMs: data.tEndMs,
      time: this.formatDuration(Math.floor(data.tStartMs / 1000)),
      isFinal: true,
      seq: data.seq,
    });
    return this.recordingsRepository.saveSegment(segment);
  }

  async updateSegmentTranslation(
    userId: string,
    recordingId: string,
    segmentId: string,
    translation: string,
  ) {
    await this.requireOwned(userId, recordingId);
    return this.recordingsRepository.updateSegmentTranslation(
      segmentId,
      recordingId,
      translation,
    );
  }

  async attachAudio(
    userId: string,
    id: string,
    file: MulterFile,
  ) {
    const recording = await this.requireOwned(userId, id);
    const stored = await this.storageService.saveAudio(userId, id, file);
    recording.audioPath = stored.relativePath;
    recording.audioMime = stored.mimeType;
    recording.audioBytes = stored.size;
    await this.recordingsRepository.save(recording);
    return {
      audioUrl: `/api/v1/recordings/${id}/audio`,
      storageKey: stored.key,
      storageProvider: stored.provider,
      storageBucket: stored.bucket,
      publicUrl: stored.publicUrl ?? null,
    };
  }

  async getAudioPath(userId: string, id: string) {
    const recording = await this.requireOwned(userId, id);
    if (!recording.audioPath) {
      throw new NotFoundException('Audio not found');
    }
    // Cloud object key (Firebase) or legacy local relative path
    return {
      key: recording.audioPath,
      mime: recording.audioMime ?? 'audio/webm',
      isCloud:
        recording.audioPath.startsWith('users/') ||
        recording.audioPath.includes('blob.vercel-storage.com') ||
        recording.audioPath.startsWith('https://'),
    };
  }

  async getAudioStream(userId: string, id: string) {
    const audio = await this.getAudioPath(userId, id);
    const downloaded = await this.storageService.download(audio.key);
    return {
      buffer: downloaded.buffer,
      mime: audio.mime || downloaded.contentType,
    };
  }

  async list(userId: string, page: number, limit: number) {
    await this.promoteStuckRecordings(userId);
    const { items, total } = await this.recordingsRepository.findPaginated(
      userId,
      page,
      limit,
    );
    return {
      items: items.map((r) => this.toDto(r)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /** Finalize sessions left in `recording` status so they appear in library */
  private async promoteStuckRecordings(userId: string) {
    const stuck = await this.recordingsRepository.findStuckRecording(userId);
    for (const recording of stuck) {
      const ageMs = Date.now() - new Date(recording.createdAt).getTime();
      if (ageMs < 2 * 60 * 1000) continue; // still actively recording
      recording.status = RecordingStatus.READY;
      if (!recording.summary) {
        const full = await this.recordingsRepository.findByIdForUser(
          recording.id,
          userId,
        );
        const texts = (full?.transcript ?? []).map((s) => s.text).join(' ');
        recording.summary = texts
          ? texts.slice(0, 150) + (texts.length > 150 ? '...' : '')
          : 'Bản ghi đã lưu (tự hoàn tất).';
        recording.isTranslated = (full?.transcript ?? []).some(
          (s) => !!s.translation,
        );
        if (!recording.aiSummary) {
          recording.aiSummary = this.aiService.buildLocalSummary(
            recording.summary,
            recording.title,
            recording.category,
          );
        }
      }
      await this.recordingsRepository.save(recording);
    }
  }

  async remove(userId: string, id: string) {
    const recording = await this.requireOwned(userId, id);
    if (recording.audioPath) {
      await this.storageService.deleteIfExists(recording.audioPath);
    }
    await this.recordingsRepository.hardDelete(id, userId);
  }

  async regenerateSummary(userId: string, id: string) {
    const recording = await this.requireOwned(userId, id);
    const full = await this.recordingsRepository.findByIdForUser(id, userId);
    const sourceText =
      (full?.transcript ?? []).map((s) => s.text).join(' ').trim() ||
      recording.summary ||
      'Chưa có transcript.';

    recording.aiSummary = await this.aiService.summarize(
      sourceText,
      recording.title,
      recording.category,
      userId,
    );
    await this.recordingsRepository.save(recording);
    const latest = await this.recordingsRepository.findByIdForUser(id, userId);
    return this.toDto(latest ?? recording, true);
  }

  private async requireOwned(userId: string, id: string) {
    const recording = await this.recordingsRepository.findByIdForUser(
      id,
      userId,
    );
    if (!recording) {
      throw new NotFoundException('Recording not found');
    }
    if (recording.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return recording;
  }

  private formatDuration(totalSec: number): string {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins
        .toString()
        .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  private toDto(recording: {
    id: string;
    title: string;
    category: string;
    status: RecordingStatus;
    duration: string;
    durationSec: number;
    summary: string;
    aiSummary: string;
    participants: Array<{ name: string; role: string; avatar: string }> | null;
    tags: string[] | null;
    isTranslated: boolean;
    audioPath: string | null;
    createdAt: Date;
    transcript?: Array<{
      time: string;
      speaker: string;
      text: string;
      translation: string | null;
    }>;
  }, includeTranscript = false) {
    return {
      id: recording.id,
      title: recording.title,
      category: recording.category,
      status: recording.status,
      date: recording.createdAt.toLocaleDateString('vi-VN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      createdAt: recording.createdAt.toISOString(),
      duration: recording.duration,
      durationSec: recording.durationSec,
      summary: recording.summary,
      aiSummary: recording.aiSummary,
      participants: recording.participants ?? [],
      tags: recording.tags ?? [],
      isTranslated: recording.isTranslated,
      hasAudio: !!recording.audioPath,
      audioUrl: recording.audioPath
        ? `/api/v1/recordings/${recording.id}/audio`
        : null,
      transcript: includeTranscript
        ? (recording.transcript ?? []).map((t) => ({
            time: t.time,
            speaker: t.speaker,
            text: t.text,
            translation: t.translation ?? undefined,
          }))
        : undefined,
    };
  }
}
