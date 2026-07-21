import { Injectable } from '@nestjs/common';
import { FirestoreStore } from '../firestore/firestore-store.service';
import { Recording } from './recording.entity';
import { TranscriptSegment } from './transcript-segment.entity';
import { RecordingCategory, RecordingStatus } from '../common/enums';

type RecordingDoc = {
  id: string;
  userId: string;
  title: string;
  category: string;
  status: RecordingStatus;
  duration: string;
  durationSec: number;
  summary: string;
  aiSummary: string;
  participants: Array<{ name: string; role: string; avatar: string }> | null;
  tags: string[] | null;
  isTranslated: boolean;
  audioPath: string | null;
  audioMime: string | null;
  audioBytes: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type SegmentDoc = {
  id: string;
  recordingId: string;
  time: string;
  tStartMs: number;
  tEndMs: number;
  speaker: string;
  text: string;
  translation: string | null;
  isFinal: boolean;
  seq: number;
  createdAt: string;
};

@Injectable()
export class RecordingsRepository {
  constructor(private readonly store: FirestoreStore) {}

  create(data: Partial<Recording>): Recording {
    const now = new Date();
    return {
      id: data.id ?? '',
      userId: data.userId ?? '',
      user: undefined as unknown as Recording['user'],
      title: data.title ?? '',
      category: data.category ?? RecordingCategory.ENGLISH,
      status: data.status ?? RecordingStatus.RECORDING,
      duration: data.duration ?? '00:00',
      durationSec: data.durationSec ?? 0,
      summary: data.summary ?? '',
      aiSummary: data.aiSummary ?? '',
      participants: data.participants ?? null,
      tags: data.tags ?? null,
      isTranslated: data.isTranslated ?? false,
      audioPath: data.audioPath ?? null,
      audioMime: data.audioMime ?? null,
      audioBytes: data.audioBytes ?? null,
      transcript: data.transcript ?? [],
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
      deletedAt: data.deletedAt ?? null,
    };
  }

  async save(recording: Recording): Promise<Recording> {
    this.store.requireReady();
    const id = recording.id || this.store.newId();
    const now = new Date();
    const createdAt = recording.createdAt ?? now;
    const doc: RecordingDoc = {
      id,
      userId: recording.userId,
      title: recording.title,
      category: recording.category,
      status: recording.status,
      duration: recording.duration,
      durationSec: recording.durationSec,
      summary: recording.summary ?? '',
      aiSummary: recording.aiSummary ?? '',
      participants: recording.participants ?? null,
      tags: recording.tags ?? null,
      isTranslated: recording.isTranslated ?? false,
      audioPath: recording.audioPath ?? null,
      audioMime: recording.audioMime ?? null,
      audioBytes: recording.audioBytes ?? null,
      createdAt: createdAt.toISOString(),
      updatedAt: now.toISOString(),
      deletedAt: recording.deletedAt
        ? recording.deletedAt.toISOString()
        : null,
    };
    await this.store.recordings().doc(id).set(doc, { merge: true });
    const saved = this.fromRecordingDoc(doc);
    saved.transcript = recording.transcript ?? [];
    return saved;
  }

  async findByIdForUser(
    id: string,
    userId: string,
  ): Promise<Recording | null> {
    this.store.requireReady();
    const snap = await this.store.recordings().doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() as RecordingDoc;
    if (data.userId !== userId || data.deletedAt) return null;
    const recording = this.fromRecordingDoc(data);
    recording.transcript = await this.loadSegments(id);
    return recording;
  }

  async findPaginated(userId: string, page: number, limit: number) {
    this.store.requireReady();
    const snap = await this.store
      .recordings()
      .where('userId', '==', userId)
      .get();

    const all = snap.docs
      .map((d) => this.fromRecordingDoc(d.data() as RecordingDoc))
      .filter((r) => !r.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    return { items, total };
  }

  async findStuckRecording(userId: string) {
    this.store.requireReady();
    const snap = await this.store
      .recordings()
      .where('userId', '==', userId)
      .where('status', '==', RecordingStatus.RECORDING)
      .get();
    return snap.docs
      .map((d) => this.fromRecordingDoc(d.data() as RecordingDoc))
      .filter((r) => !r.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20);
  }

  async softDelete(id: string, userId: string) {
    this.store.requireReady();
    const existing = await this.findByIdForUser(id, userId);
    if (!existing) {
      return { affected: 0 };
    }
    const now = new Date().toISOString();
    await this.store.recordings().doc(id).set(
      {
        deletedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
    return { affected: 1 };
  }

  /** Permanently delete recording doc + transcript segments from Firestore. */
  async hardDelete(id: string, userId: string) {
    this.store.requireReady();
    const existing = await this.findByIdForUser(id, userId);
    if (!existing) {
      return { affected: 0 };
    }

    const segmentsSnap = await this.store.segments(id).get();
    const batch = this.store.db().batch();
    for (const doc of segmentsSnap.docs) {
      batch.delete(doc.ref);
    }
    batch.delete(this.store.recordings().doc(id));
    await batch.commit();
    return { affected: 1 };
  }

  createSegment(data: Partial<TranscriptSegment>): TranscriptSegment {
    const now = new Date();
    return {
      id: data.id ?? '',
      recordingId: data.recordingId ?? '',
      recording: undefined as unknown as TranscriptSegment['recording'],
      time: data.time ?? '00:00',
      tStartMs: data.tStartMs ?? 0,
      tEndMs: data.tEndMs ?? 0,
      speaker: data.speaker ?? 'Speaker',
      text: data.text ?? '',
      translation: data.translation ?? null,
      isFinal: data.isFinal ?? true,
      seq: data.seq ?? 0,
      createdAt: data.createdAt ?? now,
    };
  }

  async saveSegment(segment: TranscriptSegment): Promise<TranscriptSegment> {
    this.store.requireReady();
    const id = segment.id || this.store.newId();
    const createdAt = segment.createdAt ?? new Date();
    const doc: SegmentDoc = {
      id,
      recordingId: segment.recordingId,
      time: segment.time,
      tStartMs: segment.tStartMs,
      tEndMs: segment.tEndMs,
      speaker: segment.speaker,
      text: segment.text,
      translation: segment.translation ?? null,
      isFinal: segment.isFinal ?? true,
      seq: segment.seq ?? 0,
      createdAt: createdAt.toISOString(),
    };
    await this.store.segments(segment.recordingId).doc(id).set(doc);
    return this.fromSegmentDoc(doc);
  }

  async updateSegmentTranslation(
    segmentId: string,
    recordingId: string,
    translation: string,
  ) {
    this.store.requireReady();
    await this.store.segments(recordingId).doc(segmentId).set(
      {
        translation,
      },
      { merge: true },
    );
  }

  async replaceTranscript(
    recordingId: string,
    segments: Partial<TranscriptSegment>[],
  ): Promise<TranscriptSegment[]> {
    this.store.requireReady();
    const existing = await this.store.segments(recordingId).get();
    const batch = this.store.db().batch();
    for (const doc of existing.docs) {
      batch.delete(doc.ref);
    }
    const created: TranscriptSegment[] = [];
    for (let idx = 0; idx < segments.length; idx++) {
      const s = segments[idx];
      const id = s.id || this.store.newId();
      const createdAt = new Date();
      const doc: SegmentDoc = {
        id,
        recordingId,
        time: s.time ?? '00:00',
        tStartMs: s.tStartMs ?? 0,
        tEndMs: s.tEndMs ?? 0,
        speaker: s.speaker ?? 'Speaker',
        text: s.text ?? '',
        translation: s.translation ?? null,
        isFinal: s.isFinal ?? true,
        seq: s.seq ?? idx,
        createdAt: createdAt.toISOString(),
      };
      batch.set(this.store.segments(recordingId).doc(id), doc);
      created.push(this.fromSegmentDoc(doc));
    }
    await batch.commit();
    return created;
  }

  countByStatus(userId: string, status: RecordingStatus) {
    return this.store
      .recordings()
      .where('userId', '==', userId)
      .where('status', '==', status)
      .where('deletedAt', '==', null)
      .get()
      .then((snap) => snap.size);
  }

  private async loadSegments(recordingId: string): Promise<TranscriptSegment[]> {
    const snap = await this.store
      .segments(recordingId)
      .orderBy('seq', 'asc')
      .get();
    return snap.docs.map((d) => this.fromSegmentDoc(d.data() as SegmentDoc));
  }

  private fromRecordingDoc(doc: RecordingDoc): Recording {
    return {
      id: doc.id,
      userId: doc.userId,
      user: undefined as unknown as Recording['user'],
      title: doc.title,
      category: doc.category,
      status: doc.status,
      duration: doc.duration,
      durationSec: doc.durationSec,
      summary: doc.summary ?? '',
      aiSummary: doc.aiSummary ?? '',
      participants: doc.participants ?? null,
      tags: doc.tags ?? null,
      isTranslated: doc.isTranslated ?? false,
      audioPath: doc.audioPath ?? null,
      audioMime: doc.audioMime ?? null,
      audioBytes: doc.audioBytes ?? null,
      transcript: [],
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      deletedAt: doc.deletedAt ? new Date(doc.deletedAt) : null,
    };
  }

  private fromSegmentDoc(doc: SegmentDoc): TranscriptSegment {
    return {
      id: doc.id,
      recordingId: doc.recordingId,
      recording: undefined as unknown as TranscriptSegment['recording'],
      time: doc.time,
      tStartMs: doc.tStartMs,
      tEndMs: doc.tEndMs,
      speaker: doc.speaker,
      text: doc.text,
      translation: doc.translation,
      isFinal: doc.isFinal,
      seq: doc.seq,
      createdAt: new Date(doc.createdAt),
    };
  }
}
