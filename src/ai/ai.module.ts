import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AiController } from './ai.controller';
import { UsersModule } from '../users/users.module';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [UsersModule],
  controllers: [AiController],
  providers: [AiService, AiUsageService, RolesGuard],
  exports: [AiService, AiUsageService],
})
export class AiModule {}
