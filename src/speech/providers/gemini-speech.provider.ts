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
  private flushing = false;
  private onResult: ((result: TranscriptResult) => void) | null = null;
  private mimeType = 'audio/webm';
  private stopped = false;

  constructor(
    private readonly ai: AiService,
    private readonly category: string,
    private readonly userId?: string,
  ) {}

  async start(onResult: (result: TranscriptResult) => void): Promise<void> {
    this.onResult = onResult;
  }

  async sendAudio(chunk: Buffer, mimeType: string): Promise<void> {
    if (this.stopped || chunk.length === 0) return;
    this.mimeType = mimeType || this.mimeType;
    this.buffer.push(chunk);
    this.bufferBytes += chunk.length;
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

  createSession(options: {
    category?: string;
    language?: string;
    userId?: string;
  }): SpeechSession {
    return new GeminiSpeechSession(
      this.ai,
      options.category ?? 'general',
      options.userId,
    );
  }
}
