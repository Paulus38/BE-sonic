import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2Service implements OnModuleInit {
  private readonly logger = new Logger(R2Service.name);
  private client: S3Client | null = null;
  private bucket = '';
  private publicBaseUrl = '';
  private accountId = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const accountId = (this.config.get<string>('app.r2.accountId') ?? '').trim();
    const accessKeyId = (
      this.config.get<string>('app.r2.accessKeyId') ?? ''
    ).trim();
    const secretAccessKey = (
      this.config.get<string>('app.r2.secretAccessKey') ?? ''
    ).trim();
    this.bucket = (this.config.get<string>('app.r2.bucket') ?? '').trim();
    this.publicBaseUrl = (
      this.config.get<string>('app.r2.publicBaseUrl') ?? ''
    ).trim().replace(/\/$/, '');
    this.accountId = accountId;

    if (!accountId || !accessKeyId || !secretAccessKey || !this.bucket) {
      this.logger.warn(
        'Cloudflare R2 chưa cấu hình (thiếu R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET). Xem be/R2_SETUP.md',
      );
      return;
    }

    const endpoint =
      (this.config.get<string>('app.r2.endpoint') ?? '').trim() ||
      `https://${accountId}.r2.cloudflarestorage.com`;

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: false,
    });

    this.logger.log(`R2 ready bucket=${this.bucket} endpoint=${endpoint}`);
  }

  isReady(): boolean {
    return !!this.client && !!this.bucket;
  }

  getBucket(): string {
    return this.bucket;
  }

  getAccountId(): string {
    return this.accountId;
  }

  /** Public URL if custom domain / r2.dev configured; otherwise null. */
  publicUrlForKey(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl}/${key.replace(/^\//, '')}`;
  }

  async putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    this.requireReady();
    await this.client!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        Metadata: params.metadata,
      }),
    );
  }

  async getObject(
    key: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    this.requireReady();
    const res = await this.client!.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`Empty R2 object: ${key}`);
    }
    return {
      buffer: Buffer.from(bytes),
      contentType: res.ContentType || 'application/octet-stream',
    };
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.isReady()) return;
    await this.client!.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async getSignedGetUrl(key: string, expiresInSec = 3600): Promise<string> {
    this.requireReady();
    return getSignedUrl(
      this.client!,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn: expiresInSec },
    );
  }

  async pingBucket(): Promise<boolean> {
    if (!this.isReady()) return false;
    try {
      await this.client!.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }

  private requireReady() {
    if (!this.isReady()) {
      throw new Error(
        'Cloudflare R2 is not configured. Set R2_* env vars — see be/R2_SETUP.md',
      );
    }
  }
}
