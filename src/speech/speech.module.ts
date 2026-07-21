import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SpeechService } from './speech.service';
import { GeminiSpeechProvider } from './providers/gemini-speech.provider';
import { DeepgramSpeechProvider } from './providers/deepgram-speech.provider';

@Module({
  imports: [AiModule],
  providers: [GeminiSpeechProvider, DeepgramSpeechProvider, SpeechService],
  exports: [SpeechService],
})
export class SpeechModule {}
