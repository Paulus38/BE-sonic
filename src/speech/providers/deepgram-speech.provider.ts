import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import {
  SpeechProvider,
  SpeechSession,
  TranscriptResult,
} from './speech-provider.interface';

class DeepgramSpeechSession implements SpeechSession {
  private readonly logger = new Logger(DeepgramSpeechSession.name);
  private socket: WebSocket | null = null;
  private onResult: ((result: TranscriptResult) => void) | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly language: string,
  ) {}

  async start(onResult: (result: TranscriptResult) => void): Promise<void> {
    this.onResult = onResult;
    const url =
      `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true` +
      `&interim_results=true&language=${encodeURIComponent(this.language)}` +
      `&encoding=linear16&sample_rate=16000`;

    await new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(url, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });
      this.socket.once('open', () => resolve());
      this.socket.once('error', (err) => reject(err));
      this.socket.on('message', (raw) => this.handleMessage(raw));
    });
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    }
  }

  async stop(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      this.socket.close();
    }
    this.socket = null;
  }

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const data = JSON.parse(raw.toString()) as {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: Array<{ transcript?: string }> };
      };
      const text = data.channel?.alternatives?.[0]?.transcript?.trim();
      if (!text || !this.onResult) return;
      this.onResult({ text, isFinal: !!data.is_final });
    } catch (err) {
      this.logger.warn(
        `Deepgram parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

@Injectable()
export class DeepgramSpeechProvider implements SpeechProvider {
  readonly name = 'deepgram';

  constructor(private readonly config: ConfigService) {}

  isReady(): boolean {
    return !!this.config.get<string>('app.deepgramApiKey')?.trim();
  }

  async probeLatencyMs(): Promise<number | null> {
    const apiKey = this.config.get<string>('app.deepgramApiKey')?.trim();
    if (!apiKey) return null;
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        headers: { Authorization: `Token ${apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return null;
      return Date.now() - started;
    } catch {
      return null;
    }
  }

  createSession(options: { language?: string }): SpeechSession {
    const apiKey = this.config.get<string>('app.deepgramApiKey');
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not configured');
    }
    return new DeepgramSpeechSession(apiKey, options.language ?? 'en');
  }
}
