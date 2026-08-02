import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../ai/ai.service';
import {
  SpeechProvider,
  SpeechSession,
  TranscriptResult,
} from './speech-provider.interface';

class GeminiSpeechSession implements SpeechSession {
  private readonly logger = new Logger(GeminiSpeechSession.name);
  private buffer: Buffer[] = [];
  private bufferBytes = 0;
  private readonly flushBytes = 48_000;
  // Hard cap so a slow/rate-limited Gemini call can't make the backlog grow
  // without bound — once a flush is in flight, keep at most ~this much
  // trailing audio and drop older bytes rather than shipping an
  // ever-larger, ever-staler blob on the next flush.
  private readonly maxBufferBytes = this.flushBytes * 4;
  private flushing = false;
  private onResult: ((result: TranscriptResult) => void) | null = null;
  private mimeType = 'audio/webm';
  private stopped = false;

  constructor(
    private readonly ai: AiService,
    private readonly category: string,
    private readonly userId?: string,
    private readonly language?: string,
  ) {}

  async start(onResult: (result: TranscriptResult) => void): Promise<void> {
    this.onResult = onResult;
  }

  async sendAudio(chunk: Buffer, mimeType: string): Promise<void> {
    if (this.stopped || chunk.length === 0) return;
    this.mimeType = mimeType || this.mimeType;
    this.buffer.push(chunk);
    this.bufferBytes += chunk.length;
    while (this.bufferBytes > this.maxBufferBytes && this.buffer.length > 1) {
      const dropped = this.buffer.shift()!;
      this.bufferBytes -= dropped.length;
      this.logger.warn(
        `Gemini audio backlog exceeded ${this.maxBufferBytes}B, dropping stale audio`,
      );
    }
    if (this.bufferBytes >= this.flushBytes && !this.flushing) {
      await this.flush(false);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.flush(true);
  }

  private async flush(force: boolean): Promise<void> {
    if (this.flushing) return;
    if (!force && this.bufferBytes < this.flushBytes) return;
    if (this.bufferBytes === 0) return;

    this.flushing = true;
    const payload = Buffer.concat(this.buffer);
    this.buffer = [];
    this.bufferBytes = 0;

    try {
      const text = await this.ai.transcribeAudio(
        payload.toString('base64'),
        this.mimeType,
        this.category,
        this.userId,
        this.language,
      );
      if (text && this.onResult) {
        this.onResult({ text, isFinal: true });
      }
    } catch (err) {
      this.logger.error(
        'Gemini transcription failed',
        err instanceof Error ? err.stack : String(err),
      );
    } finally {
      this.flushing = false;
    }
  }
}

@Injectable()
export class GeminiSpeechProvider implements SpeechProvider {
  readonly name = 'gemini';

  constructor(private readonly ai: AiService) {}

  isReady(): boolean {
    return this.ai.isAvailable();
  }

  async probeLatencyMs(): Promise<number | null> {
    return this.ai.pingMs();
  }

  createSession(options: {
    category?: string;
    language?: string;
    userId?: string;
  }): SpeechSession {
    return new GeminiSpeechSession(
      this.ai,
      options.category ?? 'general',
      options.userId,
      options.language === 'vi' ? 'vi' : options.language === 'en' ? 'en' : undefined,
    );
  }

  async transcribeBuffer(
    buffer: Buffer,
    mimeType: string,
    category = 'general',
    userId?: string,
    language?: string,
  ): Promise<string> {
    const text = await this.ai.transcribeAudio(
      buffer.toString('base64'),
      mimeType || 'audio/webm',
      category,
      userId,
      language,
    );
    if (!text.trim()) {
      throw new Error('Gemini returned empty transcript');
    }
    return text.trim();
  }
}
