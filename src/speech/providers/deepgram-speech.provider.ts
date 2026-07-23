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
    const lang = this.language === 'vi' ? 'vi' : 'en';
    // endpointing helps Vietnamese utterance boundaries (more silence gaps)
    const endpointing = lang === 'vi' ? 400 : 300;
    const url =
      `wss://api.deepgram.com/v1/listen?model=nova-2&smart_format=true` +
      `&punctuate=true&interim_results=true` +
      `&language=${encodeURIComponent(lang)}` +
      `&endpointing=${endpointing}` +
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
  private readonly logger = new Logger(DeepgramSpeechProvider.name);

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
    const language = options.language === 'vi' ? 'vi' : 'en';
    return new DeepgramSpeechSession(apiKey, language);
  }

  /** Batch / offline file transcription (prerecorded REST). */
  async transcribeBuffer(
    buffer: Buffer,
    mimeType: string,
    language = 'en',
  ): Promise<string> {
    const apiKey = this.config.get<string>('app.deepgramApiKey')?.trim();
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not configured');
    }
    const lang = language === 'vi' ? 'vi' : 'en';
    const attempts = [
      `model=nova-2&smart_format=true&punctuate=true&language=${encodeURIComponent(lang)}`,
      // Fallback: let Deepgram detect language (helps when user picks wrong lang)
      `model=nova-2&smart_format=true&punctuate=true&detect_language=true`,
    ];

    let lastError = 'Deepgram returned empty transcript';
    for (const query of attempts) {
      const url = `https://api.deepgram.com/v1/listen?${query}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': mimeType || 'audio/webm',
          },
          body: new Uint8Array(buffer),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          lastError = `Deepgram HTTP ${res.status}: ${errText.slice(0, 240)}`;
          this.logger.warn(lastError);
          continue;
        }
        const data = (await res.json()) as {
          results?: {
            channels?: Array<{
              alternatives?: Array<{ transcript?: string }>;
            }>;
          };
        };
        const text =
          data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ??
          '';
        if (text) return text;
        lastError = 'Deepgram returned empty transcript';
      } catch (err) {
        lastError =
          err instanceof Error ? err.message : 'Deepgram request failed';
        this.logger.warn(lastError);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(lastError);
  }
}
