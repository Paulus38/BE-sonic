import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
