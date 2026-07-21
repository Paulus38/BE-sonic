import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiSpeechProvider } from './providers/gemini-speech.provider';
import { DeepgramSpeechProvider } from './providers/deepgram-speech.provider';
import {
  SpeechProvider,
  SpeechSession,
} from './providers/speech-provider.interface';
import { SpeechProviderType } from '../common/enums';

type LatencyMap = Record<'gemini' | 'deepgram', number | null>;

@Injectable()
export class SpeechService implements OnModuleInit {
  private readonly logger = new Logger(SpeechService.name);
  private readonly mode: SpeechProviderType;
  private readonly providers: SpeechProvider[];
  private active: SpeechProvider;
  private latency: LatencyMap = { gemini: null, deepgram: null };
  private lastProbeAt = 0;
  private probing: Promise<void> | null = null;
  private readonly probeTtlMs = 60_000;

  constructor(
    config: ConfigService,
    private readonly gemini: GeminiSpeechProvider,
    private readonly deepgram: DeepgramSpeechProvider,
  ) {
    this.mode =
      (config.get<string>('app.speechProvider') as SpeechProviderType) ??
      SpeechProviderType.GEMINI;
    this.providers = [this.deepgram, this.gemini];

    if (this.mode === SpeechProviderType.DEEPGRAM) {
      this.active = this.deepgram;
    } else if (this.mode === SpeechProviderType.AUTO) {
      this.active = this.deepgram.isReady()
        ? this.deepgram
        : this.gemini;
    } else {
      this.active = this.gemini;
    }

    this.logger.log(
      `Speech mode: ${this.mode} (initial provider: ${this.active.name})`,
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.mode === SpeechProviderType.AUTO) {
      await this.refreshLatency(true);
    }
  }

  createSession(options: {
    language?: string;
    category?: string;
    userId?: string;
  }): SpeechSession {
    void this.refreshLatency(false);
    const ordered = this.orderedReadyProviders();
    if (ordered.length === 0) {
      throw new Error(
        'No speech provider is ready — set GEMINI_API_KEY and/or DEEPGRAM_API_KEY',
      );
    }

    let lastError: Error | null = null;
    for (const provider of ordered) {
      try {
        const session = provider.createSession(options);
        this.active = provider;
        this.logger.debug(`Speech session via ${provider.name}`);
        return this.withFailover(session, ordered, provider, options);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `${provider.name} createSession failed: ${lastError.message}`,
        );
      }
    }
    throw lastError ?? new Error('Failed to create speech session');
  }

  getProviderName(): string {
    return this.active.name;
  }

  getMode(): string {
    return this.mode;
  }

  getLatencyMs(): LatencyMap {
    return { ...this.latency };
  }

  private orderedReadyProviders(): SpeechProvider[] {
    if (this.mode === SpeechProviderType.GEMINI) {
      return this.gemini.isReady() ? [this.gemini] : [];
    }
    if (this.mode === SpeechProviderType.DEEPGRAM) {
      return this.deepgram.isReady() ? [this.deepgram] : [];
    }

    const ready = this.providers.filter((p) => p.isReady());
    return ready.sort((a, b) => {
      const la = this.latency[a.name as keyof LatencyMap];
      const lb = this.latency[b.name as keyof LatencyMap];
      if (la == null && lb == null) {
        // Prefer Deepgram when latency unknown (streaming STT is usually faster).
        return a.name === 'deepgram' ? -1 : 1;
      }
      if (la == null) return 1;
      if (lb == null) return -1;
      return la - lb;
    });
  }

  private withFailover(
    primary: SpeechSession,
    ordered: SpeechProvider[],
    used: SpeechProvider,
    options: {
      language?: string;
      category?: string;
      userId?: string;
    },
  ): SpeechSession {
    if (this.mode !== SpeechProviderType.AUTO || ordered.length < 2) {
      return primary;
    }

    const fallbacks = ordered.filter((p) => p.name !== used.name);
    let current = primary;
    let currentName = used.name;

    return {
      start: async (onResult) => {
        try {
          await current.start(onResult);
          this.active = used;
          return;
        } catch (err) {
          this.logger.warn(
            `${currentName} start failed, trying fallback: ${(err as Error).message}`,
          );
          for (const alt of fallbacks) {
            try {
              current = alt.createSession(options);
              currentName = alt.name;
              await current.start(onResult);
              this.active = alt;
              this.logger.log(`Speech failover → ${alt.name}`);
              return;
            } catch (altErr) {
              this.logger.warn(
                `${alt.name} failover failed: ${(altErr as Error).message}`,
              );
            }
          }
          throw err;
        }
      },
      sendAudio: (chunk, mimeType) => current.sendAudio(chunk, mimeType),
      stop: () => current.stop(),
    };
  }

  private async refreshLatency(force: boolean): Promise<void> {
    if (this.mode !== SpeechProviderType.AUTO) return;
    if (!force && Date.now() - this.lastProbeAt < this.probeTtlMs) return;
    if (this.probing) return this.probing;

    this.probing = (async () => {
      const results = await Promise.all(
        this.providers.map(async (p) => {
          if (!p.isReady() || !p.probeLatencyMs) {
            return [p.name, null] as const;
          }
          const ms = await p.probeLatencyMs();
          return [p.name, ms] as const;
        }),
      );

      for (const [name, ms] of results) {
        if (name === 'gemini' || name === 'deepgram') {
          this.latency[name] = ms;
        }
      }
      this.lastProbeAt = Date.now();

      const next = this.orderedReadyProviders()[0];
      if (next) {
        this.active = next;
      }

      this.logger.log(
        `Speech auto latency — deepgram=${this.latency.deepgram ?? 'n/a'}ms, gemini=${this.latency.gemini ?? 'n/a'}ms → ${this.active.name}`,
      );
    })().finally(() => {
      this.probing = null;
    });

    return this.probing;
  }
}
