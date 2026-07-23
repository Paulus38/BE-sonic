import { RecordingsRepository } from './recordings.repository';
import { FirestoreStore } from '../firestore/firestore-store.service';

describe('RecordingsRepository.replaceTranscript', () => {
  it('chunks Firestore writes when segment count exceeds batch limit', async () => {
    const commits: Array<{ deletes: number; sets: number }> = [];
    let current = { deletes: 0, sets: 0 };

    const batchFactory = () => ({
      delete: jest.fn(() => {
        current.deletes += 1;
      }),
      set: jest.fn(() => {
        current.sets += 1;
      }),
      commit: jest.fn(async () => {
        commits.push({ ...current });
        current = { deletes: 0, sets: 0 };
      }),
    });

    const existingDocs = Array.from({ length: 500 }, (_, i) => ({
      ref: { id: `old-${i}` },
    }));

    let idSeq = 0;
    const store = {
      requireReady: jest.fn(),
      newId: jest.fn(() => `seg-${++idSeq}`),
      db: jest.fn(() => ({ batch: batchFactory })),
      segments: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: existingDocs }),
        doc: jest.fn((id: string) => ({ id })),
      })),
    } as unknown as FirestoreStore;

    const repo = new RecordingsRepository(store);
    const segments = Array.from({ length: 500 }, (_, i) => ({
      text: `line ${i}`,
      time: '00:00',
      speaker: 'Speaker',
    }));

    const created = await repo.replaceTranscript('rec-1', segments);

    expect(created).toHaveLength(500);
    // 500 deletes → ceil(500/450)=2 delete batches; 500 sets → 2 write batches
    expect(commits.length).toBe(4);
    expect(commits[0].deletes).toBe(450);
    expect(commits[1].deletes).toBe(50);
    expect(commits[2].sets).toBe(450);
    expect(commits[3].sets).toBe(50);
  });
});
