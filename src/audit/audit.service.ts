import { Injectable, Logger } from '@nestjs/common';
import { FirestoreStore } from '../firestore/firestore-store.service';
import {
  AuditLogEntry,
  RecordAuditInput,
} from './audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly store: FirestoreStore) {}

  /**
   * Best-effort audit write — never throws to callers.
   * Fire-and-forget safe: callers may `void this.audit.record(...)`.
   */
  async record(input: RecordAuditInput): Promise<void> {
    if (!this.store.isReady()) return;
    try {
      this.store.requireReady();
      const id = this.store.newId();
      const createdAt = new Date().toISOString();
      const doc: AuditLogEntry = {
        id,
        userId: input.userId ?? null,
        userEmail: input.userEmail ?? null,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId ?? null,
        status: input.status ?? 'ok',
        message: input.message ?? null,
        meta: input.meta ?? null,
        ip: input.ip ?? null,
        createdAt,
      };
      await this.store.auditLogs().doc(id).set(doc);
    } catch (err) {
      this.logger.warn(
        `Audit write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async list(params: {
    limit?: number;
    action?: string;
    userId?: string;
  }): Promise<AuditLogEntry[]> {
    this.store.requireReady();
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    // MVP: fetch recent then filter in-memory (avoids composite index setup).
    const snap = await this.store
      .auditLogs()
      .orderBy('createdAt', 'desc')
      .limit(Math.min(500, limit * 4))
      .get();

    let items = snap.docs.map((d) => d.data() as AuditLogEntry);

    if (params.userId) {
      items = items.filter((e) => e.userId === params.userId);
    }
    if (params.action) {
      const needle = params.action.toLowerCase();
      items = items.filter((e) => e.action.toLowerCase().includes(needle));
    }

    return items.slice(0, limit);
  }
}
