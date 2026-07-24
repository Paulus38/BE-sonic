import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import {
  FileTranscriptResult,
  SpeechProvider,
  SpeechSession,
  TranscriptResult,
  TranscriptSegmentLine,
  formatSpeakerLabel,
} from './speech-provider.interface';

type DeepgramWord = {
  word?: string;
  punctuated_word?: string;
  speaker?: number;
  start?: number;
  end?: number;
};

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
      `&punctuate=true&interim_results=true&diarize=true` +
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
        channel?: {
          alternatives?: Array<{
            transcript?: string;
            words?: DeepgramWord[];
          }>;
        };
      };
      const alt = data.channel?.alternatives?.[0];
      const text = alt?.transcript?.trim();
      if (!text || !this.onResult) return;

      const words = alt?.words ?? [];
      if (data.is_final && words.length > 0) {
        const runs = splitWordRunsBySpeaker(words);
        for (const run of runs) {
          if (!run.text) continue;
          this.onResult({
            text: run.text,
            isFinal: true,
            speaker: formatSpeakerLabel(run.speaker),
          });
        }
        return;
      }

      const speakerIdx = dominantSpeaker(words);
      this.onResult({
        text,
        isFinal: !!data.is_final,
        speaker:
          speakerIdx != null ? formatSpeakerLabel(speakerIdx) : undefined,
      });
    } catch (err) {
      this.logger.warn(
        `Deepgram parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function dominantSpeaker(words: DeepgramWord[]): number | null {
  const counts = new Map<number, number>();
  for (const w of words) {
    if (typeof w.speaker !== 'number') continue;
    counts.set(w.speaker, (counts.get(w.speaker) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = 0;
  let bestCount = -1;
  for (const [speaker, count] of counts) {
    if (count > bestCount) {
      best = speaker;
      bestCount = count;
    }
  }
  return best;
}

function splitWordRunsBySpeaker(
  words: DeepgramWord[],
): Array<{ speaker: number; text: string }> {
  const runs: Array<{ speaker: number; text: string }> = [];
  let currentSpeaker: number | null = null;
  let tokens: string[] = [];

  const flush = () => {
    const text = tokens.join(' ').replace(/\s+/g, ' ').trim();
    if (text && currentSpeaker != null) {
      runs.push({ speaker: currentSpeaker, text });
    }
    tokens = [];
  };

  for (const w of words) {
    const token = (w.punctuated_word || w.word || '').trim();
    if (!token) continue;
    const speaker = typeof w.speaker === 'number' ? w.speaker : 0;
    if (currentSpeaker == null) {
      currentSpeaker = speaker;
    } else if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    tokens.push(token);
  }
  flush();

  if (runs.length === 0) {
    const text = words
      .map((w) => (w.punctuated_word || w.word || '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) runs.push({ speaker: 0, text });
  }
  return runs;
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

  /** Batch / offline file transcription (prerecorded REST) with diarization. */
  async transcribeBuffer(
    buffer: Buffer,
    mimeType: string,
    language = 'en',
  ): Promise<FileTranscriptResult> {
    const apiKey = this.config.get<string>('app.deepgramApiKey')?.trim();
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not configured');
    }
    const lang = language === 'vi' ? 'vi' : 'en';
    const attempts = [
      `model=nova-2&smart_format=true&punctuate=true&diarize=true&utterances=true&language=${encodeURIComponent(lang)}`,
      // Fallback: let Deepgram detect language (helps when user picks wrong lang)
      `model=nova-2&smart_format=true&punctuate=true&diarize=true&utterances=true&detect_language=true`,
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
              alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
            }>;
            utterances?: Array<{
              speaker?: number;
              transcript?: string;
              start?: number;
              end?: number;
            }>;
          };
        };

        const fullText =
          data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ??
          '';
        const segments = utterancesToSegments(data.results?.utterances);
        if (segments.length > 0) {
          return {
            text: fullText || segments.map((s) => s.text).join(' '),
            segments,
          };
        }

        if (fullText) {
          const words = data.results?.channels?.[0]?.alternatives?.[0]?.words;
          const fromWords = wordsToSegments(words);
          if (fromWords.length > 0) {
            return { text: fullText, segments: fromWords };
          }
          return {
            text: fullText,
            segments: [
              {
                text: fullText,
                speaker: 'Speaker 1',
                tStartMs: 0,
                tEndMs: 0,
              },
            ],
          };
        }
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

function utterancesToSegments(
  utterances?: Array<{
    speaker?: number;
    transcript?: string;
    start?: number;
    end?: number;
  }>,
): TranscriptSegmentLine[] {
  if (!utterances?.length) return [];
  return utterances
    .map((u) => {
      const text = u.transcript?.trim() ?? '';
      if (!text) return null;
      const speaker =
        typeof u.speaker === 'number'
          ? formatSpeakerLabel(u.speaker)
          : 'Speaker 1';
      return {
        text,
        speaker,
        tStartMs: Math.max(0, Math.round((u.start ?? 0) * 1000)),
        tEndMs: Math.max(0, Math.round((u.end ?? u.start ?? 0) * 1000)),
      };
    })
    .filter((s): s is TranscriptSegmentLine => !!s);
}

function wordsToSegments(words?: DeepgramWord[]): TranscriptSegmentLine[] {
  if (!words?.length) return [];

  const segments: TranscriptSegmentLine[] = [];
  let currentSpeaker: number | null = null;
  let runWords: DeepgramWord[] = [];

  const flush = () => {
    if (currentSpeaker == null || runWords.length === 0) return;
    const text = runWords
      .map((w) => (w.punctuated_word || w.word || '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return;
    const start = runWords[0]?.start ?? 0;
    const end = runWords[runWords.length - 1]?.end ?? start;
    segments.push({
      text,
      speaker: formatSpeakerLabel(currentSpeaker),
      tStartMs: Math.max(0, Math.round(start * 1000)),
      tEndMs: Math.max(0, Math.round(end * 1000)),
    });
    runWords = [];
  };

  for (const w of words) {
    const token = (w.punctuated_word || w.word || '').trim();
    if (!token) continue;
    const speaker = typeof w.speaker === 'number' ? w.speaker : 0;
    if (currentSpeaker == null) currentSpeaker = speaker;
    else if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    runWords.push(w);
  }
  flush();
  return segments;
}
