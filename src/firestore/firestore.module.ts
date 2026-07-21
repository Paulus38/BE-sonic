import { Global, Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { FirestoreStore } from './firestore-store.service';

@Global()
@Module({
  imports: [FirebaseModule],
  providers: [FirestoreStore],
  exports: [FirestoreStore],
})
export class FirestoreModule {}
