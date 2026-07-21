import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { AiService } from './ai/ai.service';
import { SpeechService } from './speech/speech.service';
import { FirebaseService } from './firebase/firebase.service';
import { FirestoreStore } from './firestore/firestore-store.service';
import { R2Service } from './storage/r2.service';
import { VercelBlobService } from './storage/vercel-blob.service';

@ApiTags('health')
@Controller('api/v1/health')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly aiService: AiService,
    private readonly speechService: SpeechService,
    private readonly firebase: FirebaseService,
    private readonly firestore: FirestoreStore,
    private readonly r2: R2Service,
    private readonly vercelBlob: VercelBlobService,
  ) {}

  @Get()
  @SkipThrottle()
  check() {
    const provider = this.vercelBlob.isReady()
      ? 'vercel-blob'
      : this.r2.isReady()
        ? 'r2'
        : 'local-fallback';

    return {
      status: 'ok',
      service: this.config.get<string>('app.name'),
      dbProvider: this.config.get<string>('app.db.provider') ?? 'firestore',
      speechProvider: this.speechService.getProviderName(),
      speechMode: this.speechService.getMode(),
      speechLatencyMs: this.speechService.getLatencyMs(),
      geminiActive: this.aiService.isAvailable(),
      storage: {
        provider,
        vercelBlob: {
          ready: this.vercelBlob.isReady(),
          access: this.vercelBlob.getAccess(),
          setupHint: this.vercelBlob.isReady()
            ? null
            : 'Set BLOB_READ_WRITE_TOKEN — see be/VERCEL_BLOB_SETUP.md',
        },
        r2: {
          ready: this.r2.isReady(),
          bucket: this.r2.getBucket() || null,
        },
      },
      firebase: {
        projectId: this.firebase.getProjectId(),
        ready: this.firebase.isReady(),
        firestoreReady: this.firestore.isReady(),
      },
      timestamp: new Date().toISOString(),
    };
  }
}
