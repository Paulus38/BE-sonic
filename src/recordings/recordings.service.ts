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
  ConfirmClientAudioDto,
  CreateRecordingDto,
  FinalizeRecordingDto,
  RetranscribeRecordingDto,
} from './dto/recording.dto';
import { RecordingStatus } from '../common/enums';
import { AiService } from '../ai/ai.service';
import {
  isAllowedAudioMime,
  normalizeMimeType,
  StorageService,
} from '../storage/storage.service';
import { SpeechService } from '../speech/speech.service';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/user.entity';
import { MulterFile } from '../common/types/uploaded-file';
import { VercelBlobService } from '../storage/vercel-blob.service';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    private readonly recordingsRepository: RecordingsRepository,
    private readonly aiService: AiService,
    private readonly storageService: StorageService,
    private readonly vercelBlob: VercelBlobService,
    private readonly config: ConfigService,
    private readonly speechService: SpeechService,
    private readonly audit: AuditService,
  ) {}

  /** Draft khi bắt đầu ghi — status=RECORDING, chưa có audio/transcript. */
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

  /** Chi tiết + transcript segments — Detail / player. */
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

  /**
   * Ghi metadata + transcript sau khi audio đã có trên storage.
   * Atomic rule: reject nếu !audioPath. FE chỉ gọi sau uploadAudio OK.
   */
  async finalize(userId: string, id: string, dto: FinalizeRecordingDto) {
    const recording = await this.requireOwned(userId, id);
    if (!recording.audioPath) {
      throw new BadRequestException(
        'Chưa có file audio — upload audio thành công rồi mới lưu transcript/metadata',
      );
    }
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

  /**
   * @deprecated UNUSED — live session không còn ghi segment mid-flight (atomic save).
   * Trước đây: LiveService.commitFinal → append từng câu vào Firestore.
   * Giờ transcript chỉ vào DB qua finalize(). Có thể xóa cùng updateSegmentTranslation.
   */
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

  /**
   * @deprecated UNUSED — không còn caller sau khi bỏ persist mid-session.
   * Trước đây cập nhật bản dịch EN→VI cho segment đã append.
   */
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

  /**
   * Server multipart upload (fallback). Nest nhận file → StorageService.saveAudio.
   * Dùng khi Blob chưa sẵn sàng hoặc FE fallback file nhỏ.
   * API: POST /:id/audio
   */
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

  /**
   * Client-upload bước 1 — pathname + access cho browser.
   * API: GET /:id/audio/upload-info
   */
  async getClientUploadInfo(
    userId: string,
    id: string,
    preferredMime?: string,
  ) {
    await this.requireOwned(userId, id);
    const maxMb = this.config.get<number>('app.maxAudioMb') ?? 200;
    const mime = normalizeMimeType(preferredMime || 'audio/webm');
    const ext = mime.includes('mp4')
      ? '.mp4'
      : mime.includes('aac')
        ? '.aac'
        : mime.includes('ogg')
          ? '.ogg'
          : mime.includes('wav')
            ? '.wav'
            : '.webm';
    return {
      clientUpload: this.vercelBlob.isReady(),
      access: this.vercelBlob.getAccess(),
      pathname: `users/${userId}/recordings/${id}/${randomUUID()}${ext}`,
      maxBytes: maxMb * 1024 * 1024,
      allowedContentTypes: [
        'audio/webm',
        'audio/wav',
        'audio/mpeg',
        'audio/mp4',
        'audio/ogg',
        'audio/aac',
        'audio/x-wav',
        'audio/x-m4a',
        'video/webm',
      ],
    };
  }

  /**
   * Client-upload bước 2 — generate token (@vercel/blob handleUpload).
   * API: POST /:id/audio/client-upload (raw JSON)
   */
  async handleClientUploadToken(
    userId: string,
    id: string,
    body: unknown,
    request: import('express').Request,
  ) {
    await this.requireOwned(userId, id);
    if (!this.vercelBlob.isReady()) {
      throw new BadGatewayException(
        'Vercel Blob chưa cấu hình — không dùng được client upload',
      );
    }
    const { handleUpload } = await import('@vercel/blob/client');
    const maxMb = this.config.get<number>('app.maxAudioMb') ?? 200;
    const prefix = `users/${userId}/recordings/${id}/`;
    return handleUpload({
      body: body as Parameters<typeof handleUpload>[0]['body'],
      request,
      token: this.vercelBlob.getToken(),
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith(prefix)) {
          throw new BadRequestException(
            `pathname phải thuộc ${prefix}`,
          );
        }
        return {
          allowedContentTypes: [
            'audio/webm',
            'audio/wav',
            'audio/mpeg',
            'audio/mp4',
            'audio/ogg',
            'audio/aac',
            'audio/x-wav',
            'audio/x-m4a',
            'video/webm',
          ],
          maximumSizeInBytes: maxMb * 1024 * 1024,
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify({ userId, recordingId: id }),
        };
      },
    });
  }

  /**
   * Client-upload bước 3 — gắn Blob URL vào recording.audioPath.
   * API: POST /:id/audio/confirm
   * Chưa finalize transcript — chỉ đánh dấu audio đã lưu.
   */
  async attachClientAudio(
    userId: string,
    id: string,
    dto: ConfirmClientAudioDto,
  ) {
    const recording = await this.requireOwned(userId, id);
    const url = (dto.url || '').trim();
    if (!url.startsWith('https://') || !this.vercelBlob.isVercelBlobRef(url)) {
      throw new BadRequestException('URL audio không hợp lệ (cần Vercel Blob)');
    }
    const prefix = `users/${userId}/recordings/${id}/`;
    if (!url.includes(prefix) && !decodeURIComponent(url).includes(prefix)) {
      throw new BadRequestException('URL audio không thuộc bản ghi này');
    }
    const mime = normalizeMimeType(dto.contentType || 'audio/webm');
    if (!isAllowedAudioMime(mime)) {
      throw new BadRequestException(`MIME không hỗ trợ: ${mime}`);
    }
    const maxMb = this.config.get<number>('app.maxAudioMb') ?? 200;
    const size = dto.size ?? 0;
    if (size > maxMb * 1024 * 1024) {
      throw new BadRequestException(`File vượt giới hạn ${maxMb}MB`);
    }

    if (recording.audioPath && recording.audioPath !== url) {
      try {
        await this.storageService.deleteIfExists(recording.audioPath);
      } catch {
        // ignore stale cleanup
      }
    }

    recording.audioPath = url;
    recording.audioMime = mime;
    recording.audioBytes = size || recording.audioBytes || null;
    await this.recordingsRepository.save(recording);
    void this.audit.record({
      userId,
      action: 'recording.audio_upload',
      resource: 'audio',
      resourceId: id,
      meta: {
        bytes: size || null,
        mime,
        provider: 'vercel-blob',
        via: 'client-upload',
      },
    });
    return {
      audioUrl: `/api/v1/recordings/${id}/audio`,
      storageKey: url,
      storageProvider: 'vercel-blob',
      publicUrl: url,
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

  /** Auto-complete abandoned sessions only when audio already uploaded. */
  private async promoteStuckRecordings(userId: string) {
    const stuck = await this.recordingsRepository.findStuckRecording(userId);
    for (const recording of stuck) {
      const ageMs = Date.now() - new Date(recording.createdAt).getTime();
      if (ageMs < 2 * 60 * 1000) continue; // still actively recording
      // No audio → discard draft so library never shows transcript-only orphans
      if (!recording.audioPath) {
        if (ageMs > 30 * 60 * 1000) {
          try {
            await this.recordingsRepository.hardDelete(recording.id, userId);
            this.logger.log(
              `Deleted abandoned recording without audio: ${recording.id}`,
            );
          } catch (err) {
            this.logger.warn(
              `Cleanup abandoned recording failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        continue;
      }
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
