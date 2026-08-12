export interface AuditLogEntry {
  id: string;
  recordId: string;
  actorEmail: string;
  action: string;
  timestamp: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
