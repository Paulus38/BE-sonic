import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Groq's transcription endpoint only accepts these container/extensions. */
const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
};

function extFor(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] ?? 'webm';
}

/**
 * File-only fallback for retranscribe. Runs Whisper via Groq's free-tier,
 * OpenAI-compatible endpoint (org can't pay for the OpenAI API directly).
 * No diarization (like Gemini) and not used for live sessions — this is a
 * REST/batch endpoint, not a streaming API suited to the live socket path.
 */
@Injectable()
export class WhisperSpeechProvider {
  readonly name = 'whisper';
  private readonly logger = new Logger(WhisperSpeechProvider.name);
  private readonly apiKey: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('app.groqApiKey')?.trim() ?? '';
    this.model =
      this.config.get<string>('app.groqWhisperModel') || 'whisper-large-v3-turbo';
    if (!this.apiKey) {
      this.logger.warn('GROQ_API_KEY missing — Whisper fallback disabled');
    }
  }

  isReady(): boolean {
    return !!this.apiKey;
  }

  async transcribeBuffer(
    buffer: Buffer,
    mimeType: string,
    language?: string,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }
    const mime = mimeType || 'audio/webm';
    const ext = extFor(mime);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), `audio.${ext}`);
    form.append('model', this.model);
    if (language === 'vi' || language === 'en') {
      form.append('language', language);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Whisper(Groq) HTTP ${res.status}: ${errText.slice(0, 240)}`);
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? '').trim();
      if (!text) {
        throw new Error('Whisper(Groq) returned empty transcript');
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
