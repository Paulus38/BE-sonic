import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RecordingsRepository } from './recordings.repository';
import {
  CreateRecordingDto,
  FinalizeRecordingDto,
  RetranscribeRecordingDto,
} from './dto/recording.dto';
import { RecordingStatus } from '../common/enums';
import { AiService } from '../ai/ai.service';
import { StorageService } from '../storage/storage.service';
import { SpeechService } from '../speech/speech.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import { MulterFile } from '../common/types/uploaded-file';

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly recordingsRepository: RecordingsRepository,
    private readonly aiService: AiService,
    private readonly storageService: StorageService,
    private readonly speechService: SpeechService,
    private readonly audit: AuditService,
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
    const saved = await this.recordingsRepository.save(recording);
    void this.audit.record({
      userId: user.id,
      userEmail: user.email,
      action: 'recording.create',
      resource: 'recording',
      resourceId: saved.id,
      meta: { category: saved.category },
    });
    return this.toDto(saved);
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

    // Only call Gemini when FE explicitly requests it (avoids burning free-tier tokens).
    if (dto.generateSummary === true) {
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
    void this.audit.record({
      userId,
      action: 'recording.finalize',
      resource: 'recording',
      resourceId: saved.id,
      meta: {
        durationSec: saved.durationSec,
        lines: dto.transcript?.length ?? 0,
        generateSummary: dto.generateSummary === true,
      },
    });
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
    void this.audit.record({
      userId,
      action: 'recording.audio_upload',
      resource: 'audio',
      resourceId: id,
      meta: {
        bytes: stored.size,
        mime: stored.mimeType,
        provider: stored.provider,
      },
    });
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
    void this.audit.record({
      userId,
      action: 'recording.delete',
      resource: 'recording',
      resourceId: id,
    });
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
    void this.audit.record({
      userId,
      action: 'recording.summarize',
      resource: 'ai',
      resourceId: id,
    });
    const latest = await this.recordingsRepository.findByIdForUser(id, userId);
    return this.toDto(latest ?? recording, true);
  }

  /**
   * Re-run STT on stored audio (fallback when live transcript failed / empty).
   * Replaces existing transcript segments.
   */
  async retranscribe(
    userId: string,
    id: string,
    dto: RetranscribeRecordingDto = {},
  ) {
    const recording = await this.requireOwned(userId, id);
    if (!recording.audioPath) {
      throw new BadRequestException(
        'Bản ghi chưa có audio — không thể transcript lại',
      );
    }

    try {
      const audio = await this.getAudioStream(userId, id);
      const language = dto.language === 'vi' ? 'vi' : 'en';
      const { text, provider } = await this.speechService.transcribeFile({
        buffer: audio.buffer,
        mimeType: audio.mime || 'audio/webm',
        language,
        category: recording.category,
        userId,
      });

      const lines = this.splitTranscriptLines(text, recording.durationSec);
      const wantTranslate =
        dto.translate !== false && language === 'en';

      const withTranslations: Array<{
        time: string;
        speaker: string;
        text: string;
        translation: string | null;
        tStartMs: number;
        tEndMs: number;
        isFinal: boolean;
        seq: number;
      }> = [];

      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        let translation: string | null = null;
        if (wantTranslate) {
          try {
            const vi = await this.aiService.translateLive(line.text, userId);
            translation = vi || null;
          } catch {
            translation = null;
          }
        }
        withTranslations.push({
          ...line,
          translation,
          isFinal: true,
          seq: idx,
        });
      }

      const segments = await this.recordingsRepository.replaceTranscript(
        recording.id,
        withTranslations,
      );
      recording.transcript = segments;
      recording.isTranslated = segments.some((s) => !!s.translation);
      const fullText = segments.map((s) => s.text).join(' ');
      recording.summary =
        fullText.slice(0, 150) + (fullText.length > 150 ? '...' : '');
      recording.status = RecordingStatus.READY;
      const tags = new Set(recording.tags ?? []);
      tags.add('Re-transcribed');
      tags.add(provider);
      recording.tags = Array.from(tags);
      await this.recordingsRepository.save(recording);
      void this.audit.record({
        userId,
        action: 'recording.retranscribe',
        resource: 'ai',
        resourceId: id,
        meta: { language, provider, lines: segments.length },
      });

      const latest = await this.recordingsRepository.findByIdForUser(
        id,
        userId,
      );
      return {
        ...this.toDto(latest ?? recording, true),
        sttProvider: provider,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Retranscribe failed for ${id}: ${msg}`);
      void this.audit.record({
        userId,
        action: 'recording.retranscribe',
        resource: 'ai',
        resourceId: id,
        status: 'error',
        message: msg.slice(0, 400),
      });
      if (err instanceof BadRequestException) throw err;
      throw new BadGatewayException(
        `Transcript lại thất bại: ${msg.slice(0, 400)}`,
      );
    }
  }

  private splitTranscriptLines(
    text: string,
    durationSec: number,
  ): Array<{
    time: string;
    speaker: string;
    text: string;
    tStartMs: number;
    tEndMs: number;
  }> {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return [
        {
          time: '00:00',
          speaker: 'Speaker',
          text: '(Không nhận diện được lời nói trong audio)',
          tStartMs: 0,
          tEndMs: Math.max(0, durationSec) * 1000,
        },
      ];
    }

    const parts = cleaned
      .split(/(?<=[.!?…。])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const chunks =
      parts.length > 0
        ? parts
        : cleaned.match(/.{1,220}(\s|$)/g)?.map((s) => s.trim()).filter(Boolean) ||
          [cleaned];

    const totalMs = Math.max(1000, (durationSec || chunks.length * 3) * 1000);
    const step = Math.floor(totalMs / chunks.length);

    return chunks.map((chunk, idx) => {
      const tStartMs = idx * step;
      const tEndMs = idx === chunks.length - 1 ? totalMs : (idx + 1) * step;
      return {
        time: this.formatDuration(Math.floor(tStartMs / 1000)),
        speaker: 'Speaker',
        text: chunk,
        tStartMs,
        tEndMs,
      };
    });
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
