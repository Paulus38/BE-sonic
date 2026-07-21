import { Injectable, NotFoundException } from '@nestjs/common';
import { FirestoreStore } from '../firestore/firestore-store.service';
import { CreateDictionaryItemDto } from './dto/create-dictionary-item.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

type DictionaryDoc = {
  id: string;
  userId: string;
  word: string;
  phonetic: string | null;
  definition: string;
  example: string;
  category: string;
  recordingId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

@Injectable()
export class DictionaryService {
  constructor(private readonly store: FirestoreStore) {}

  async create(userId: string, dto: CreateDictionaryItemDto) {
    this.store.requireReady();
    const now = new Date().toISOString();
    const id = this.store.newId();
    const doc: DictionaryDoc = {
      id,
      userId,
      word: dto.word.trim(),
      phonetic: dto.phonetic?.trim() ?? null,
      definition: dto.definition.trim(),
      example: dto.example?.trim() ?? '',
      category: dto.category ?? 'Học Tiếng Anh',
      recordingId: dto.recordingId ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await this.store.dictionary().doc(id).set(doc);
    return this.toDto(doc);
  }

  async list(userId: string, query: PaginationDto) {
    this.store.requireReady();
    const snap = await this.store
      .dictionary()
      .where('userId', '==', userId)
      .get();
    const all = snap.docs
      .map((d) => d.data() as DictionaryDoc)
      .filter((d) => !d.deletedAt)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    const total = all.length;
    const start = (query.page - 1) * query.limit;
    const items = all.slice(start, start + query.limit);
    return {
      items: items.map((i) => this.toDto(i)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  async remove(userId: string, id: string): Promise<void> {
    this.store.requireReady();
    const snap = await this.store.dictionary().doc(id).get();
    if (!snap.exists) {
      throw new NotFoundException('Dictionary item not found');
    }
    const data = snap.data() as DictionaryDoc;
    if (data.userId !== userId) {
      throw new NotFoundException('Dictionary item not found');
    }
    // Hard delete — free Firestore storage immediately
    await this.store.dictionary().doc(id).delete();
  }

  private toDto(item: DictionaryDoc) {
    return {
      id: item.id,
      word: item.word,
      phonetic: item.phonetic ?? undefined,
      definition: item.definition,
      example: item.example,
      category: item.category,
      recordingId: item.recordingId ?? undefined,
    };
  }
}
