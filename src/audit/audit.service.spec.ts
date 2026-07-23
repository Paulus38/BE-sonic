import { AuditService } from './audit.service';
import { FirestoreStore } from '../firestore/firestore-store.service';
import { AuditLogEntry } from './audit.types';

describe('AuditService', () => {
  const set = jest.fn().mockResolvedValue(undefined);
  const doc = jest.fn(() => ({ set }));
  const get = jest.fn();
  const limit = jest.fn(() => ({ get }));
  const orderBy = jest.fn(() => ({ limit }));
  const auditLogs = jest.fn(() => ({ doc, orderBy }));

  const store = {
    isReady: jest.fn(() => true),
    requireReady: jest.fn(),
    newId: jest.fn(() => 'audit-id-1'),
    auditLogs,
  } as unknown as FirestoreStore;

  let service: AuditService;

  beforeEach(() => {
    jest.clearAllMocks();
    (store.isReady as jest.Mock).mockReturnValue(true);
    service = new AuditService(store);
  });

  describe('record', () => {
    it('writes an audit document when Firestore is ready', async () => {
      await service.record({
        userId: 'u1',
        userEmail: 'a@b.com',
        action: 'auth.login',
        resource: 'auth',
        resourceId: 'u1',
      });

      expect(store.requireReady).toHaveBeenCalled();
      expect(doc).toHaveBeenCalledWith('audit-id-1');
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-id-1',
          userId: 'u1',
          action: 'auth.login',
          resource: 'auth',
          status: 'ok',
        }),
      );
    });

    it('no-ops when Firestore is not ready', async () => {
      (store.isReady as jest.Mock).mockReturnValue(false);
      await service.record({
        action: 'auth.login',
        resource: 'auth',
      });
      expect(set).not.toHaveBeenCalled();
    });

    it('swallows write errors (never throws)', async () => {
      set.mockRejectedValueOnce(new Error('firestore down'));
      await expect(
        service.record({
          action: 'recording.create',
          resource: 'recording',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    const sample: AuditLogEntry[] = [
      {
        id: '1',
        userId: 'u1',
        userEmail: 'a@b.com',
        action: 'auth.login',
        resource: 'auth',
        resourceId: 'u1',
        status: 'ok',
        message: null,
        meta: null,
        ip: null,
        createdAt: '2026-07-23T10:00:00.000Z',
      },
      {
        id: '2',
        userId: 'u2',
        userEmail: 'c@d.com',
        action: 'recording.finalize',
        resource: 'recording',
        resourceId: 'r1',
        status: 'ok',
        message: null,
        meta: null,
        ip: null,
        createdAt: '2026-07-23T09:00:00.000Z',
      },
    ];

    beforeEach(() => {
      get.mockResolvedValue({
        docs: sample.map((d) => ({ data: () => d })),
      });
    });

    it('returns recent logs capped by limit', async () => {
      const items = await service.list({ limit: 1 });
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('1');
    });

    it('filters by userId and action substring', async () => {
      const byUser = await service.list({ userId: 'u2', limit: 50 });
      expect(byUser).toHaveLength(1);
      expect(byUser[0].action).toBe('recording.finalize');

      const byAction = await service.list({ action: 'auth', limit: 50 });
      expect(byAction).toHaveLength(1);
      expect(byAction[0].action).toBe('auth.login');
    });
  });
});
