import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import { join, resolve } from 'path';
import { R2Service } from './r2.service';
import { VercelBlobService } from './vercel-blob.service';
import { FirebaseService } from '../firebase/firebase.service';
import { FirestoreStore } from '../firestore/firestore-store.service';
import { MulterFile } from '../common/types/uploaded-file';

/** Strip `;codecs=opus` etc. so Chrome MediaRecorder types match allowlist. */
export function normalizeMimeType(mime: string): string {
  return (mime || '').split(';')[0].trim().toLowerCase();
}

const ALLOWED_AUDIO_MIME = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/x-wav',
  'audio/aac',
  'audio/x-m4a',
  'video/webm',
]);

export function isAllowedAudioMime(mime: string): boolean {
  return ALLOWED_AUDIO_MIME.has(normalizeMimeType(mime));
}

export type StoredObject = {
  /** Path/URL stored in Firestore audioPath */
  key: string;
  relativePath: string;
  mimeType: string;
  size: number;
  bucket: string;
  provider: 'vercel-blob' | 'r2' | 'firebase' | 'local';
  publicUrl?: string | null;
};

/**
 * Priority: Vercel Blob → R2 → local fallback.
 * DB stores audioPath = blob URL (Vercel) or object key (R2) or local relative path.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly maxBytes: number;
  private readonly uploadDir: string;
  private readonly allowLocalFallback: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly vercelBlob: VercelBlobService,
    private readonly r2: R2Service,
    private readonly firebase: FirebaseService,
    private readonly store: FirestoreStore,
  ) {
    const maxMb = this.config.get<number>('app.maxAudioMb') ?? 50;
    this.maxBytes = maxMb * 1024 * 1024;
    this.uploadDir = resolve(
      this.config.get<string>('app.uploadDir') ?? './uploads',
    );
    this.allowLocalFallback =
      (process.env.STORAGE_ALLOW_LOCAL_FALLBACK ?? 'false') === 'true';
  }

  assertValidAudio(file?: MulterFile): void {
    if (!file) {
      throw new BadRequestException('Cần file âm thanh để upload');
    }
    const base = normalizeMimeType(file.mimetype);
    if (!isAllowedAudioMime(base)) {
      throw new BadRequestException(
        `Định dạng audio không hỗ trợ (${file.mimetype || 'unknown'}). Dùng webm/mp4/wav/ogg/aac.`,
      );
    }
    // Persist base type so Blob metadata / extension stay clean.
    file.mimetype = base;
    if (file.size > this.maxBytes) {
      throw new BadRequestException(
        `File audio vượt giới hạn ${Math.round(this.maxBytes / (1024 * 1024))}MB`,
      );
    }
  }

  async saveAudio(
    userId: string,
    recordingId: string,
    file: MulterFile,
  ): Promise<StoredObject> {
    this.assertValidAudio(file);
    const ext = this.extensionFor(file.mimetype);
    const pathname = `users/${userId}/recordings/${recordingId}/${randomUUID()}${ext}`;

    // 1) Vercel Blob (preferred free hobby storage)
    if (this.vercelBlob.isReady()) {
      try {
        const blob = await this.vercelBlob.putObject({
          pathname,
          body: file.buffer,
          contentType: file.mimetype,
        });
        this.logger.log(`Uploaded audio → Vercel Blob ${blob.url}`);
        return {
          // Store full URL in DB so we can fetch/delete easily
          key: blob.url,
          relativePath: blob.url,
          mimeType: file.mimetype,
          size: file.size,
          bucket: 'vercel-blob',
          provider: 'vercel-blob',
          publicUrl: blob.url,
        };
      } catch (err) {
        this.logger.error(
          `Vercel Blob upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!this.allowLocalFallback && !this.r2.isReady()) {
          throw new ServiceUnavailableException(
            `Upload Vercel Blob thất bại: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    // 2) Cloudflare R2
    if (this.r2.isReady()) {
      try {
        await this.r2.putObject({
          key: pathname,
          body: file.buffer,
          contentType: file.mimetype,
          metadata: { userId, recordingId },
        });
        const publicUrl = this.r2.publicUrlForKey(pathname);
        this.logger.log(`Uploaded audio → r2://${this.r2.getBucket()}/${pathname}`);
        return {
          key: pathname,
          relativePath: pathname,
          mimeType: file.mimetype,
          size: file.size,
          bucket: this.r2.getBucket(),
          provider: 'r2',
          publicUrl,
        };
      } catch (err) {
        this.logger.error(
          `R2 upload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!this.allowLocalFallback) {
          throw new ServiceUnavailableException(
            `Upload R2 thất bại: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    if (!this.allowLocalFallback) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình storage cloud. Đặt BLOB_READ_WRITE_TOKEN (Vercel Blob) — xem be/VERCEL_BLOB_SETUP.md',
      );
    }

    this.logger.warn('Cloud storage chưa sẵn sàng — lưu audio local tạm thời');
    return this.saveAudioLocal(userId, recordingId, file);
  }

  private async saveAudioLocal(
    userId: string,
    recordingId: string,
    file: MulterFile,
  ): Promise<StoredObject> {
    const ext = this.extensionFor(file.mimetype);
    const dir = join(this.uploadDir, userId, recordingId);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const filename = `${randomUUID()}${ext}`;
    const absolute = join(dir, filename);
    await fs.writeFile(absolute, file.buffer);
    const relativePath = join(userId, recordingId, filename);
    this.logger.log(`Saved audio locally → ${absolute}`);
    return {
      key: relativePath,
      relativePath,
      mimeType: file.mimetype,
      size: file.size,
      bucket: 'local',
      provider: 'local',
      publicUrl: null,
    };
  }

  async saveImage(
    userId: string,
    file: MulterFile,
  ): Promise<StoredObject> {
    if (!file) throw new BadRequestException('Image file is required');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Unsupported image type');
    }
    if (file.size > this.maxBytes) {
      throw new BadRequestException('Image exceeds size limit');
    }

    const ext =
      file.mimetype === 'image/png'
        ? '.png'
        : file.mimetype === 'image/webp'
          ? '.webp'
          : '.jpg';
    const pathname = `users/${userId}/images/${randomUUID()}${ext}`;

    if (this.vercelBlob.isReady()) {
      const blob = await this.vercelBlob.putObject({
        pathname,
        body: file.buffer,
        contentType: file.mimetype,
      });
      return {
        key: blob.url,
        relativePath: blob.url,
        mimeType: file.mimetype,
        size: file.size,
        bucket: 'vercel-blob',
        provider: 'vercel-blob',
        publicUrl: blob.url,
      };
    }

    if (this.r2.isReady()) {
      await this.r2.putObject({
        key: pathname,
        body: file.buffer,
        contentType: file.mimetype,
      });
      return {
        key: pathname,
        relativePath: pathname,
        mimeType: file.mimetype,
        size: file.size,
        bucket: this.r2.getBucket(),
        provider: 'r2',
        publicUrl: this.r2.publicUrlForKey(pathname),
      };
    }

    const dir = join(this.uploadDir, userId, 'images');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    await fs.writeFile(join(dir, filename), file.buffer);
    const relativePath = join(userId, 'images', filename);
    return {
      key: relativePath,
      relativePath,
      mimeType: file.mimetype,
      size: file.size,
      bucket: 'local',
      provider: 'local',
      publicUrl: null,
    };
  }

  async download(
    key: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    // Only allow HTTPS fetch for known Vercel Blob hosts (prevent SSRF).
    if (this.vercelBlob.isVercelBlobRef(key)) {
      if (!this.vercelBlob.isReady()) {
        throw new ServiceUnavailableException(
          'Vercel Blob chưa cấu hình — không tải được audio.',
        );
      }
      return this.vercelBlob.download(key);
    }

    if (key.startsWith('https://') || key.startsWith('http://')) {
      throw new BadRequestException('Unsupported audio URL host');
    }

    if (key.startsWith('users/')) {
      if (this.r2.isReady()) {
        try {
          return await this.r2.getObject(key);
        } catch (err) {
          this.logger.warn(
            `R2 get failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (this.firebase.isReady()) {
        try {
          const file = this.firebase.bucket().file(key);
          const [buffer] = await file.download();
          const [metadata] = await file.getMetadata();
          return {
            buffer,
            contentType: String(
              metadata.contentType || 'application/octet-stream',
            ),
          };
        } catch (err) {
          this.logger.warn(
            `Firebase get failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      throw new ServiceUnavailableException(
        'Không đọc được audio cloud (R2/Firebase).',
      );
    }

    const absolute = resolve(this.uploadDir, key);
    if (!absolute.startsWith(this.uploadDir)) {
      throw new BadRequestException('Invalid audio path');
    }
    if (!existsSync(absolute)) {
      throw new BadRequestException('Audio file missing on disk');
    }
    const buffer = await fs.readFile(absolute);
    return { buffer, contentType: 'application/octet-stream' };
  }

  async getSignedUrl(key: string, _expiresInSec = 3600): Promise<string> {
    if (this.vercelBlob.isVercelBlobRef(key) || key.startsWith('https://')) {
      return key;
    }
    if (key.startsWith('users/') && this.r2.isReady()) {
      const publicUrl = this.r2.publicUrlForKey(key);
      if (publicUrl) return publicUrl;
      return this.r2.getSignedGetUrl(key, _expiresInSec);
    }
    throw new ServiceUnavailableException(
      'Không có signed URL — dùng GET /recordings/:id/audio',
    );
  }

  async deleteIfExists(keyOrPath: string): Promise<void> {
    if (!keyOrPath) return;
    if (this.vercelBlob.isVercelBlobRef(keyOrPath)) {
      try {
        await this.vercelBlob.deleteByUrl(keyOrPath);
      } catch (err) {
        this.logger.warn(
          `Vercel Blob delete failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    if (keyOrPath.startsWith('users/')) {
      if (this.r2.isReady()) {
        try {
          await this.r2.deleteObject(keyOrPath);
        } catch (err) {
          this.logger.warn(
            `R2 delete failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (this.firebase.isReady()) {
        try {
          await this.firebase
            .bucket()
            .file(keyOrPath)
            .delete({ ignoreNotFound: true });
        } catch {
          // ignore
        }
      }
      return;
    }
    const absolute = resolve(this.uploadDir, keyOrPath);
    if (absolute.startsWith(this.uploadDir) && existsSync(absolute)) {
      await fs.unlink(absolute).catch(() => undefined);
    }
  }

  /**
   * Real cloud storage used by this user (audio blobs).
   * Prefer live Vercel Blob listing; fallback to Firestore audioBytes / local files.
   */
  async getUserUsage(userId: string): Promise<{
    usedBytes: number;
    quotaBytes: number;
    fileCount: number;
    provider: string;
    source: 'vercel-blob' | 'firestore' | 'local' | 'mixed';
  }> {
    const quotaGb = parseFloat(process.env.STORAGE_QUOTA_GB ?? '1');
    const quotaBytes = Math.max(0.1, quotaGb) * 1024 * 1024 * 1024;
    const prefix = `users/${userId}/`;

    if (this.vercelBlob.isReady()) {
      try {
        const listed = await this.vercelBlob.listUsageByPrefix(prefix);
        return {
          usedBytes: listed.bytes,
          quotaBytes,
          fileCount: listed.count,
          provider: 'vercel-blob',
          source: 'vercel-blob',
        };
      } catch (err) {
        this.logger.warn(
          `Blob list usage failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let usedBytes = 0;
    let fileCount = 0;
    let source: 'firestore' | 'local' | 'mixed' = 'firestore';

    if (this.store.isReady()) {
      const snap = await this.store
        .recordings()
        .where('userId', '==', userId)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data() as {
          deletedAt?: string | null;
          audioBytes?: number | null;
          audioPath?: string | null;
        };
        if (data.deletedAt) continue;
        if (typeof data.audioBytes === 'number' && data.audioBytes > 0) {
          usedBytes += data.audioBytes;
          fileCount += 1;
        } else if (data.audioPath) {
          fileCount += 1;
        }
      }
    }

    const localUserDir = join(this.uploadDir, 'users', userId);
    if (existsSync(localUserDir)) {
      const local = await this.sumDirBytes(localUserDir);
      if (local.bytes > 0) {
        usedBytes += local.bytes;
        fileCount += local.count;
        source = usedBytes > local.bytes ? 'mixed' : 'local';
      }
    }

    return {
      usedBytes,
      quotaBytes,
      fileCount,
      provider: this.vercelBlob.isReady()
        ? 'vercel-blob'
        : this.r2.isReady()
          ? 'r2'
          : 'local-fallback',
      source,
    };
  }

  private async sumDirBytes(
    dir: string,
  ): Promise<{ bytes: number; count: number }> {
    let bytes = 0;
    let count = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.sumDirBytes(full);
        bytes += nested.bytes;
        count += nested.count;
      } else if (entry.isFile()) {
        const st = await fs.stat(full);
        bytes += st.size;
        count += 1;
      }
    }
    return { bytes, count };
  }

  private extensionFor(mime: string): string {
    const base = normalizeMimeType(mime);
    if (base.includes('wav')) return '.wav';
    if (base.includes('mpeg')) return '.mp3';
    if (base.includes('ogg')) return '.ogg';
    if (base.includes('mp4') || base.includes('m4a') || base.includes('aac')) {
      return '.m4a';
    }
    return '.webm';
  }
}
