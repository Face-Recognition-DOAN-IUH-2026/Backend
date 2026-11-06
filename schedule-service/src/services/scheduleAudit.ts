import { Repository } from 'typeorm';
import { ScheduleAuditLog } from '../entities';
import { getAuditContext } from '../middlewares/auditContext';

/**
 * writeAuditLog — shared audit trail writer.
 * Single place that maps request context (IP/UA/path) onto a ScheduleAuditLog row.
 * Used by every schedule domain service so the audit shape stays consistent.
 */
export async function writeAuditLog(
  audit: Repository<ScheduleAuditLog>,
  action: string,
  entityType: string,
  entityId: string | null,
  actorId: string | null,
  metadata: Record<string, unknown> | null | undefined,
  actorName?: string | null,
): Promise<void> {
  const ctx = getAuditContext();
  await audit.save(audit.create({
    action,
    entityType,
    entityId,
    actorId: actorId || null,
    actorName: actorName || null,
    metadata: metadata ?? null,
    ipAddress: ctx?.ipAddress || null,
    userAgent: ctx?.userAgent || null,
    requestPath: ctx?.requestPath || null,
  }));
}
