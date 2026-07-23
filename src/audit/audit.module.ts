import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { RolesGuard } from '../common/guards/roles.guard';

@Module({
  imports: [FirestoreModule],
  controllers: [AuditController],
  providers: [AuditService, RolesGuard],
  exports: [AuditService],
})
export class AuditModule {}
