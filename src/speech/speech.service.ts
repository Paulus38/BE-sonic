import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiSpeechProvider } from './providers/gemini-speech.provider';
import { DeepgramSpeechProvider } from './providers/deepgram-speech.provider';
import {
  SpeechProvider,
  SpeechSession,
} from './providers/speech-provider.interface';
import { SpeechProviderType } from '../common/enums';

@Injectable()
export class SpeechService {
  private readonly logger = new Logger(SpeechService.name);
  private readonly provider: SpeechProvider;

  constructor(
    config: ConfigService,
    gemini: GeminiSpeechProvider,
    deepgram: DeepgramSpeechProvider,
  ) {
    const selected =
      (config.get<string>('app.speechProvider') as SpeechProviderType) ??
      SpeechProviderType.GEMINI;

    if (selected === SpeechProviderType.DEEPGRAM) {
      this.provider = deepgram;
    } else {
      this.provider = gemini;
    }
    this.logger.log(`Speech provider: ${this.provider.name}`);
  }

  createSession(options: {
    language?: string;
    category?: string;
    userId?: string;
  }): SpeechSession {
    return this.provider.createSession(options);
  }

  getProviderName(): string {
    return this.provider.name;
  }
}
