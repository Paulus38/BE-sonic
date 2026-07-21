import { Injectable, ServiceUnavailableException } from '@nestjs/common';
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
export class FirestoreStore {
  constructor(private readonly firebase: FirebaseService) {}

  isReady() {
    return this.firebase.isReady();
  }

  requireReady() {
    if (!this.isReady()) {
      throw new ServiceUnavailableException(
        'Firestore is not ready. Add be/secrets/sonic-27ed5-firebase-adminsdk.json',
      );
    }
  }

  db(): Firestore {
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

  /** Aggregate AI token usage per user */
  aiUsage(): CollectionReference {
    return this.db().collection('ai_usage');
  }

  aiUsageEvents(userId: string): CollectionReference {
    return this.aiUsage().doc(userId).collection('events');
  }

  newId() {
    return randomUUID();
  }

  /** Map raw Firestore/gRPC errors to actionable HTTP errors. */
  rethrow(err: unknown): never {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? Number((err as { code: unknown }).code)
        : undefined;
    const message = err instanceof Error ? err.message : String(err);

    if (
      code === 5 ||
      /NOT_FOUND/i.test(message) ||
      /does not exist/i.test(message)
    ) {
      throw new ServiceUnavailableException(
        'Firestore database chưa được tạo trên project sonic-27ed5. Mở https://console.firebase.google.com/project/sonic-27ed5/firestore và bấm Create database (Native mode), rồi thử lại.',
      );
    }
    if (code === 7 || /PERMISSION_DENIED/i.test(message)) {
      throw new ServiceUnavailableException(
        'Service account không đủ quyền Firestore. Cấp role Cloud Datastore User / Firebase Admin cho firebase-adminsdk.',
      );
    }
    throw err instanceof Error ? err : new Error(message);
  }
}
