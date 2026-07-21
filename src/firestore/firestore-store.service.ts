import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { randomUUID } from 'crypto';
import type {
  CollectionReference,
  Firestore,
} from 'firebase-admin/firestore';

/**
 * Firestore access for project sonic-27ed5.
 *
 * Collections:
 * - users/{userId}
 * - recordings/{recordingId}
 * - recordings/{recordingId}/segments/{segmentId}
 * - dictionary/{itemId}
 */
@Injectable()
export class FirestoreStore implements OnModuleInit {
  private readonly logger = new Logger(FirestoreStore.name);

  constructor(private readonly firebase: FirebaseService) {}

  onModuleInit() {
    if (this.firebase.isReady()) {
      this.logger.log('Firestore ready on sonic-27ed5');
    } else {
      this.logger.warn(
        'Firestore idle — waiting for Admin SDK credentials (be/secrets/*-adminsdk.json)',
      );
    }
  }

  isReady() {
    return this.firebase.isReady();
  }

  private db(): Firestore {
    return this.firebase.firestore();
  }

  users(): CollectionReference {
    return this.db().collection('users');
  }

  recordings(): CollectionReference {
    return this.db().collection('recordings');
  }

  segments(recordingId: string): CollectionReference {
    return this.recordings().doc(recordingId).collection('segments');
  }

  dictionary(): CollectionReference {
    return this.db().collection('dictionary');
  }

  newId() {
    return randomUUID();
  }
}
