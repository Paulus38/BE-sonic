import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { AiService } from './ai/ai.service';
import { SpeechService } from './speech/speech.service';
import { FirebaseService } from './firebase/firebase.service';

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    private readonly speechService: SpeechService,
    private readonly firebase: FirebaseService,
  ) {}

  @Get()
  @SkipThrottle()
  check() {
    return {
      status: 'ok',
      service: this.config.get<string>('app.name'),
      speechProvider: this.speechService.getProviderName(),
      geminiActive: this.aiService.isAvailable(),
        firebase: {
        projectId: this.firebase.getProjectId(),
        bucket: this.firebase.getBucketName(),
        ready: this.firebase.isReady(),
        setupHint: this.firebase.isReady()
          ? null
          : 'Add be/secrets/sonic-27ed5-firebase-adminsdk.json — see be/FIREBASE_SETUP.md',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
