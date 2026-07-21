import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { R2Service } from './r2.service';
import { VercelBlobService } from './vercel-blob.service';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  providers: [VercelBlobService, R2Service, StorageService],
  exports: [StorageService, VercelBlobService, R2Service],
})
export class StorageModule {}
