import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { put, del, get, list } from '@vercel/blob';

@Injectable()
export class VercelBlobService implements OnModuleInit {
  private readonly logger = new Logger(VercelBlobService.name);
  private token = '';
  private access: 'public' | 'private' = 'private';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.token = (
      this.config.get<string>('app.vercelBlob.token') ??
      process.env.BLOB_READ_WRITE_TOKEN ??
      ''
    ).trim();
    const access = (
      this.config.get<string>('app.vercelBlob.access') ?? 'private'
    ).trim();
    this.access = access === 'public' ? 'public' : 'private';

    if (!this.token) {
      this.logger.warn(
        'Vercel Blob chưa cấu hình — đặt BLOB_READ_WRITE_TOKEN (xem be/VERCEL_BLOB_SETUP.md)',
      );
      return;
    }
    this.logger.log(
      `Vercel Blob ready (access=${this.access}). https://vercel.com/dashboard/stores`,
    );
  }

  isReady(): boolean {
    return !!this.token;
  }

  getAccess(): 'public' | 'private' {
    return this.access;
  }

  async putObject(params: {
    pathname: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ url: string; pathname: string }> {
    this.requireReady();
    const blob = await put(params.pathname, params.body, {
      access: this.access,
      token: this.token,
      contentType: params.contentType,
      addRandomSuffix: false,
    });
    return { url: blob.url, pathname: blob.pathname };
  }

  async download(
    urlOrPathname: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    this.requireReady();
    const result = await get(urlOrPathname, {
      access: this.access,
      token: this.token,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error(`Vercel Blob get failed for ${urlOrPathname}`);
    }
    const arrayBuf = await new Response(result.stream).arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuf),
      contentType: result.blob.contentType || 'application/octet-stream',
    };
  }

  async deleteByUrl(url: string): Promise<void> {
    if (!this.isReady() || !url) return;
    await del(url, { token: this.token });
  }

  /** List blob sizes under a pathname prefix (real cloud usage). */
  async listUsageByPrefix(
    prefix: string,
  ): Promise<{ bytes: number; count: number }> {
    this.requireReady();
    let cursor: string | undefined;
    let bytes = 0;
    let count = 0;
    do {
      const page = await list({
        prefix,
        cursor,
        limit: 1000,
        token: this.token,
      });
      for (const blob of page.blobs) {
        bytes += blob.size || 0;
        count += 1;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return { bytes, count };
  }

  isVercelBlobRef(value: string): boolean {
    return (
      value.includes('blob.vercel-storage.com') ||
      (value.startsWith('https://') && value.includes('vercel-storage'))
    );
  }

  private requireReady() {
    if (!this.isReady()) {
      throw new Error(
        'Vercel Blob is not configured. Set BLOB_READ_WRITE_TOKEN — see be/VERCEL_BLOB_SETUP.md',
      );
    }
  }
}
