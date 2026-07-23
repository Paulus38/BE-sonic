export type AuditResource =
  | 'auth'
  | 'recording'
  | 'audio'
  | 'ai'
  | 'admin'
  | 'live';

export type AuditStatus = 'ok' | 'error';

export type AuditLogEntry = {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resource: AuditResource;
  resourceId: string | null;
  status: AuditStatus;
  message: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
};

export type RecordAuditInput = {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  resource: AuditResource;
  resourceId?: string | null;
  status?: AuditStatus;
  message?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
};
