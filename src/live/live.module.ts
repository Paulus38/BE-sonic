import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpeechModule } from '../speech/speech.module';
import { AiModule } from '../ai/ai.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { UsersModule } from '../users/users.module';
import { LiveService } from './live.service';
import { LiveGateway } from './live.gateway';

@Module({
  imports: [AuthModule, SpeechModule, AiModule, RecordingsModule, UsersModule],
  providers: [LiveService, LiveGateway],
})
export class LiveModule {}
