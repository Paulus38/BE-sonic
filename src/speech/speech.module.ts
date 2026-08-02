import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { SpeechService } from './speech.service';
import { GeminiSpeechProvider } from './providers/gemini-speech.provider';
import { DeepgramSpeechProvider } from './providers/deepgram-speech.provider';
import { WhisperSpeechProvider } from './providers/whisper-speech.provider';

@Module({
  imports: [AiModule],
  providers: [
    GeminiSpeechProvider,
    DeepgramSpeechProvider,
    WhisperSpeechProvider,
    SpeechService,
  ],
  exports: [SpeechService],
})
export class SpeechModule {}
