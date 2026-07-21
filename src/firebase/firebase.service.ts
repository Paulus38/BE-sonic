import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: admin.app.App | null = null;
  private bucketName = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const projectId =
      this.config.get<string>('app.firebase.projectId') || 'sonic-27ed5';
    this.bucketName =
      this.config.get<string>('app.firebase.storageBucket') ||
      `${projectId}.firebasestorage.app`;

    const enabled = this.config.get<boolean>('app.firebase.enabled') ?? true;
    if (!enabled) {
      this.logger.warn('Firebase disabled via FIREBASE_ENABLED=false');
      return;
    }

    if (admin.apps.length) {
      this.app = admin.app();
      this.logger.log(`Firebase reuse existing app (project=${projectId})`);
      return;
    }

    try {
      const credential = this.resolveCredential();
      this.app = admin.initializeApp({
        credential,
        projectId,
        storageBucket: this.bucketName,
      });
      this.logger.log(
        `Firebase ready project=${projectId} bucket=${this.bucketName}`,
      );
    } catch (err) {
      this.logger.warn(
        `Firebase init skipped: ${err instanceof Error ? err.message : String(err)}. Add service account JSON to be/secrets/ to enable Storage + Firestore.`,
      );
      this.app = null;
    }
  }

  isReady(): boolean {
    return !!this.app;
  }

  getProjectId(): string {
    return this.config.get<string>('app.firebase.projectId') || 'sonic-27ed5';
  }

  getBucketName(): string {
    return this.bucketName;
  }

  bucket() {
    if (!this.app) {
      throw new Error(
        'Firebase is not initialized. Set FIREBASE_SERVICE_ACCOUNT_PATH for project sonic-27ed5.',
      );
    }
    return this.app.storage().bucket(this.bucketName);
  }

  firestore() {
    if (!this.app) {
      throw new Error(
        'Firestore is not initialized. Set FIREBASE_SERVICE_ACCOUNT_PATH for project sonic-27ed5.',
      );
    }
    return this.app.firestore();
  }

  private resolveCredential(): admin.credential.Credential {
    const jsonInline = this.config.get<string>(
      'app.firebase.serviceAccountJson',
    );
    if (jsonInline?.trim()) {
      const parsed = JSON.parse(jsonInline) as admin.ServiceAccount;
      return admin.credential.cert(parsed);
    }

    const pathCfg = this.config.get<string>('app.firebase.serviceAccountPath');
    if (pathCfg?.trim()) {
      const absolute = resolve(pathCfg);
      if (!existsSync(absolute)) {
        throw new Error(`Service account file not found: ${absolute}`);
      }
      const parsed = JSON.parse(
        readFileSync(absolute, 'utf8'),
      ) as admin.ServiceAccount;
      return admin.credential.cert(parsed);
    }

    return admin.credential.applicationDefault();
  }
}
