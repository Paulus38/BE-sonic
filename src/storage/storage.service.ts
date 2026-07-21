import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/x-wav',
  'video/webm',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export type StoredObject = {
  /** Cloud object key: users/{uid}/recordings/{id}/{uuid}.ext */
  key: string;
  relativePath: string;
  mimeType: string;
  size: number;
  bucket: string;
  provider: 'firebase';
};

/**
 * Cloud-only media storage (Firebase Storage — project sonic-27ed5).
 * New audio/images are NEVER written under local uploads/ or src/.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly config: ConfigService,
    private readonly firebase: FirebaseService,
  ) {
    const maxMb = this.config.get<number>('app.maxAudioMb') ?? 50;
    this.maxBytes = maxMb * 1024 * 1024;
  }

  assertValidAudio(file?: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('Audio file is required');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Unsupported audio type');
    }
    if (file.size > this.maxBytes) {
      throw new BadRequestException('Audio file exceeds size limit');
    }
  }

  async saveAudio(
    userId: string,
    recordingId: string,
    file: Express.Multer.File,
  ): Promise<StoredObject> {
    this.assertValidAudio(file);
    this.requireCloud();

    const ext = this.extensionFor(file.mimetype);
    const key = `users/${userId}/recordings/${recordingId}/${randomUUID()}${ext}`;
    await this.firebase.bucket().file(key).save(file.buffer, {
      resumable: false,
      contentType: file.mimetype,
      metadata: {
        cacheControl: 'private, max-age=3600',
        metadata: { userId, recordingId },
      },
    });

    this.logger.log(
      `Uploaded audio → gs://${this.firebase.getBucketName()}/${key}`,
    );

    return {
      key,
      relativePath: key,
      mimeType: file.mimetype,
      size: file.size,
      bucket: this.firebase.getBucketName(),
      provider: 'firebase',
    };
  }

  async saveImage(
    userId: string,
    file: Express.Multer.File,
  ): Promise<StoredObject> {
    if (!file) throw new BadRequestException('Image file is required');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Unsupported image type');
    }
    if (file.size > this.maxBytes) {
      throw new BadRequestException('Image exceeds size limit');
    }
    this.requireCloud();

    const ext =
      file.mimetype === 'image/png'
        ? '.png'
        : file.mimetype === 'image/webp'
          ? '.webp'
          : '.jpg';
    const key = `users/${userId}/images/${randomUUID()}${ext}`;
    await this.firebase.bucket().file(key).save(file.buffer, {
      resumable: false,
      contentType: file.mimetype,
    });

    return {
      key,
      relativePath: key,
      mimeType: file.mimetype,
      size: file.size,
      bucket: this.firebase.getBucketName(),
      provider: 'firebase',
    };
  }

  async download(
    key: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    this.requireCloud();
    if (!key.startsWith('users/')) {
      throw new ServiceUnavailableException(
        'Bản ghi dùng đường dẫn local cũ — ghi âm lại để lưu trên Firebase Storage.',
      );
    }
    const file = this.firebase.bucket().file(key);
    const [buffer] = await file.download();
    const [metadata] = await file.getMetadata();
    return {
      buffer,
      contentType: String(metadata.contentType || 'application/octet-stream'),
    };
  }

  async getSignedUrl(key: string, expiresInSec = 3600): Promise<string> {
    this.requireCloud();
    const [url] = await this.firebase.bucket().file(key).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInSec * 1000,
    });
    return url;
  }

  async deleteIfExists(keyOrPath: string): Promise<void> {
    if (!keyOrPath?.startsWith('users/')) return;
    if (!this.firebase.isReady()) return;
    try {
      await this.firebase
        .bucket()
        .file(keyOrPath)
        .delete({ ignoreNotFound: true });
    } catch (err) {
      this.logger.warn(
        `Cloud delete failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private requireCloud() {
    if (!this.firebase.isReady()) {
      throw new ServiceUnavailableException(
        'Firebase Storage chưa sẵn sàng. Đặt service account tại be/secrets/sonic-27ed5-firebase-adminsdk.json rồi restart BE. Xem be/FIREBASE_SETUP.md',
      );
    }
  }

  private extensionFor(mime: string): string {
    if (mime.includes('wav')) return '.wav';
    if (mime.includes('mpeg')) return '.mp3';
    if (mime.includes('ogg')) return '.ogg';
    if (mime.includes('mp4')) return '.m4a';
    return '.webm';
  }
}
