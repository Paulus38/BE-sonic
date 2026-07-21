import { Injectable } from '@nestjs/common';
import { FirestoreStore } from '../firestore/firestore-store.service';
import { User } from './user.entity';
import { UserRole } from '../common/enums';

type UserDoc = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  avatar: string | null;
  primaryLang: string;
  secondaryLang: string;
  sampleRate: number;
  aiNoiseCancellation: boolean;
  theme: 'light' | 'dark';
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

@Injectable()
export class UsersRepository {
  constructor(private readonly store: FirestoreStore) {}

  create(data: Partial<User>): User {
    const now = new Date();
    return {
      id: data.id ?? '',
      name: data.name ?? '',
      email: (data.email ?? '').toLowerCase(),
      passwordHash: data.passwordHash ?? '',
      avatar: data.avatar ?? null,
      primaryLang: data.primaryLang ?? 'Tiếng Việt',
      secondaryLang: data.secondaryLang ?? 'Tiếng Anh (US)',
      sampleRate: data.sampleRate ?? 48,
      aiNoiseCancellation: data.aiNoiseCancellation ?? true,
      theme: data.theme ?? 'light',
      role: (data.role as UserRole) ?? UserRole.USER,
      recordings: [],
      dictionaryItems: [],
      createdAt: data.createdAt ?? now,
      updatedAt: data.updatedAt ?? now,
      deletedAt: data.deletedAt ?? null,
    };
  }

  async save(user: User): Promise<User> {
    this.store.requireReady();
    try {
      const id = user.id || this.store.newId();
      const now = new Date();
      const createdAt = user.createdAt ?? now;
      const doc: UserDoc = {
        id,
        name: user.name,
        email: user.email.toLowerCase(),
        passwordHash: user.passwordHash,
        avatar: user.avatar ?? null,
        primaryLang: user.primaryLang ?? 'Tiếng Việt',
        secondaryLang: user.secondaryLang ?? 'Tiếng Anh (US)',
        sampleRate: user.sampleRate ?? 48,
        aiNoiseCancellation: user.aiNoiseCancellation ?? true,
        theme: user.theme ?? 'light',
        role: (user.role as UserRole) || UserRole.USER,
        createdAt: createdAt.toISOString(),
        updatedAt: now.toISOString(),
        deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
      };
      await this.store.users().doc(id).set(doc, { merge: true });
      return this.fromDoc(doc);
    } catch (err) {
      this.store.rethrow(err);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    this.store.requireReady();
    try {
      const snap = await this.store
        .users()
        .where('email', '==', email.toLowerCase())
        .limit(5)
        .get();
      const doc = snap.docs
        .map((d) => d.data() as UserDoc)
        .find((d) => !d.deletedAt);
      return doc ? this.fromDoc(doc) : null;
    } catch (err) {
      this.store.rethrow(err);
    }
  }

  async findById(id: string): Promise<User | null> {
    this.store.requireReady();
    try {
      const doc = await this.store.users().doc(id).get();
      if (!doc.exists) return null;
      const data = doc.data() as UserDoc;
      if (data.deletedAt) return null;
      return this.fromDoc(data);
    } catch (err) {
      this.store.rethrow(err);
    }
  }

  async listAll(): Promise<User[]> {
    this.store.requireReady();
    try {
      const snap = await this.store.users().get();
      return snap.docs
        .map((d) => d.data() as UserDoc)
        .filter((d) => !d.deletedAt)
        .map((d) => this.fromDoc(d))
        .sort((a, b) => a.email.localeCompare(b.email));
    } catch (err) {
      this.store.rethrow(err);
    }
  }

  async hardDelete(id: string): Promise<void> {
    this.store.requireReady();
    try {
      await this.store.users().doc(id).delete();
    } catch (err) {
      this.store.rethrow(err);
    }
  }

  private fromDoc(doc: UserDoc): User {
    return {
      id: doc.id,
      name: doc.name,
      email: doc.email,
      passwordHash: doc.passwordHash,
      avatar: doc.avatar,
      primaryLang: doc.primaryLang ?? 'Tiếng Việt',
      secondaryLang: doc.secondaryLang ?? 'Tiếng Anh (US)',
      sampleRate: doc.sampleRate ?? 48,
      aiNoiseCancellation: doc.aiNoiseCancellation ?? true,
      theme: doc.theme ?? 'light',
      role: doc.role === UserRole.ADMIN ? UserRole.ADMIN : UserRole.USER,
      recordings: [],
      dictionaryItems: [],
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      deletedAt: doc.deletedAt ? new Date(doc.deletedAt) : null,
    };
  }
}
