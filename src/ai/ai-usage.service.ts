import { Injectable, Logger } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreStore } from '../firestore/firestore-store.service';
import { AiFeature } from '../common/enums';

export type AiUsageSummary = {
  userId: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestCount: number;
  byFeature: Record<string, number>;
  updatedAt: string | null;
};

export type AiUsageEvent = {
  id: string;
  feature: AiFeature;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
};

@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly store: FirestoreStore) {}

  async record(
    userId: string | undefined,
    feature: AiFeature,
    model: string,
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    },
  ): Promise<void> {
    if (!userId || !this.store.isReady()) return;

    const promptTokens = Math.max(0, Math.round(usage.promptTokens ?? 0));
    const completionTokens = Math.max(
      0,
      Math.round(usage.completionTokens ?? 0),
    );
    let totalTokens = Math.max(0, Math.round(usage.totalTokens ?? 0));
    if (!totalTokens) totalTokens = promptTokens + completionTokens;
    if (!totalTokens) return;

    try {
      this.store.requireReady();
      const now = new Date().toISOString();
      const ref = this.store.aiUsage().doc(userId);
      await ref.set(
        {
          userId,
          totalPromptTokens: FieldValue.increment(promptTokens),
          totalCompletionTokens: FieldValue.increment(completionTokens),
          totalTokens: FieldValue.increment(totalTokens),
          requestCount: FieldValue.increment(1),
          [`byFeature.${feature}`]: FieldValue.increment(totalTokens),
          updatedAt: now,
        },
        { merge: true },
      );

      const eventId = this.store.newId();
      await this.store.aiUsageEvents(userId).doc(eventId).set({
        id: eventId,
        feature,
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        createdAt: now,
      });
    } catch (err) {
      this.logger.warn(
        `AI usage record failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getSummary(userId: string): Promise<AiUsageSummary> {
    this.store.requireReady();
    const snap = await this.store.aiUsage().doc(userId).get();
    if (!snap.exists) {
      return {
        userId,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
        byFeature: {},
        updatedAt: null,
      };
    }
    const data = snap.data() as Record<string, unknown>;
    return {
      userId,
      totalPromptTokens: Number(data.totalPromptTokens ?? 0),
      totalCompletionTokens: Number(data.totalCompletionTokens ?? 0),
      totalTokens: Number(data.totalTokens ?? 0),
      requestCount: Number(data.requestCount ?? 0),
      byFeature: (data.byFeature as Record<string, number>) ?? {},
      updatedAt: (data.updatedAt as string) ?? null,
    };
  }

  async getEvents(userId: string, limit = 30): Promise<AiUsageEvent[]> {
    this.store.requireReady();
    const snap = await this.store
      .aiUsageEvents(userId)
      .orderBy('createdAt', 'desc')
      .limit(Math.min(100, Math.max(1, limit)))
      .get();
    return snap.docs.map((d) => d.data() as AiUsageEvent);
  }

  async listAllSummaries(): Promise<AiUsageSummary[]> {
    this.store.requireReady();
    const snap = await this.store.aiUsage().get();
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        userId: d.id,
        totalPromptTokens: Number(data.totalPromptTokens ?? 0),
        totalCompletionTokens: Number(data.totalCompletionTokens ?? 0),
        totalTokens: Number(data.totalTokens ?? 0),
        requestCount: Number(data.requestCount ?? 0),
        byFeature: (data.byFeature as Record<string, number>) ?? {},
        updatedAt: (data.updatedAt as string) ?? null,
      };
    });
  }
}
