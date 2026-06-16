import { Between, In, MoreThanOrEqual } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../data-source';
import { AccessLog } from '../entities/AccessLog';
import { PatronAccessState } from '../entities/PatronAccessState';
import {
  AccessRealtimeEvent,
  AccessRealtimeEventSchema,
  AccessStatus,
  AccessType,
  ACTIVE_CAMERA_IDS,
  ACCESS_STATUSES,
  RecognitionEventInputSchema,
} from '../contracts';
import { UserServiceClient } from '../clients/UserServiceClient';
import { realtimeHub } from '../realtime/RealtimeHub';
import { HttpError } from '../middlewares/errorHandler';

const logRepo = () => AppDataSource.getRepository(AccessLog);
const stateRepo = () => AppDataSource.getRepository(PatronAccessState);
const users = new UserServiceClient();

function toIso(value: Date | string | undefined | null) {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeStatus(status: unknown): AccessStatus {
  if (status === 'success') return 'granted';
  if (status === 'unknown') return 'no_match';
  if (typeof status === 'string' && (ACCESS_STATUSES as readonly string[]).includes(status)) return status as AccessStatus;
  return 'error';
}

function publicStatus(log: AccessLog) {
  return log.status === 'success' ? 'granted' : log.status;
}

async function enrichLogs(logs: AccessLog[]) {
  const userMap = await users.getUsers(logs.map((log) => log.patronId || '').filter(Boolean));
  return logs.map((log) => {
    const user = log.patronId ? userMap.get(log.patronId) : null;
    return {
      id: log.id,
      patron_id: log.patronId,
      access_type: log.accessType,
      verify_method: log.verifyMethod,
      confidence: log.confidence,
      camera_id: log.cameraId,
      image_url: log.imageUrl,
      status: publicStatus(log),
      access_time: log.accessTime,
      created_at: log.accessTime,
      event_id: log.eventId,
      source: log.source,
      user: user
        ? {
            id: user.id,
            full_name: user.fullName,
            fullName: user.fullName,
            email: user.email,
            student_code: user.studentCode,
            studentCode: user.studentCode,
            card_number: user.cardNumber,
            cardNumber: user.cardNumber,
          }
        : null,
      full_name: user?.fullName || null,
      student_code: user?.studentCode || null,
    };
  });
}

export class AccessService {
  async recordRecognitionEvent(input: any): Promise<AccessRealtimeEvent> {
    const parsedInput = RecognitionEventInputSchema.parse(input || {});
    const status = normalizeStatus(parsedInput.status);
    const cameraId = String(parsedInput.camera_id || 'unknown');
    const patronId = parsedInput.patron_id ? String(parsedInput.patron_id) : null;
    let accessType = parsedInput.access_type ? String(parsedInput.access_type) as AccessType : null;
    const occurredAt = toIso(parsedInput.occurred_at);

    if (!accessType && cameraId === 'entry_gate') accessType = 'entry';
    if (!accessType && cameraId === 'exit_gate') accessType = 'exit';
    if (!accessType && cameraId === 'kiosk' && patronId) {
      const state = await stateRepo().findOne({ where: { patronId } });
      accessType = state?.currentStatus === 'inside' ? 'exit' : 'entry';
    }

    const event: AccessRealtimeEvent = {
      event_id: String(parsedInput.event_id || randomUUID()),
      event_type: 'camera_event',
      camera_id: cameraId,
      access_type: accessType,
      status,
      patron_id: patronId,
      student_code: parsedInput.student_code || null,
      full_name: parsedInput.full_name || null,
      score: typeof parsedInput.score === 'number' ? parsedInput.score : parsedInput.confidence ?? null,
      bbox: parsedInput.bbox ?? null,
      landmarks: parsedInput.landmarks ?? null,
      occurred_at: occurredAt,
      source: parsedInput.source || 'face-recognition-service',
      image_url: parsedInput.image_url || null,
    };

    const realtimeEvent = AccessRealtimeEventSchema.parse(event);

    if (status === 'granted' && patronId && accessType) {
      await logRepo().save(logRepo().create({
        id: parsedInput.log_id || undefined,
        patronId,
        accessType,
        verifyMethod: parsedInput.verify_method || 'face',
        confidence: realtimeEvent.score ?? null,
        cameraId,
        imageUrl: realtimeEvent.image_url || null,
        status: 'success',
        eventId: realtimeEvent.event_id,
        source: realtimeEvent.source,
        accessTime: new Date(occurredAt),
      }));
      await this.upsertState(patronId, accessType, cameraId, new Date(occurredAt));
    }

    await realtimeHub.publish(realtimeEvent);
    return realtimeEvent;
  }

  async getRecent(limit = 20) {
    const logs = await logRepo().find({
      where: { cameraId: In([...ACTIVE_CAMERA_IDS]) },
      order: { accessTime: 'DESC' },
      take: Math.min(limit, 100),
    });
    return enrichLogs(logs);
  }

  async getLogs(query: { patronId?: string; dateFrom?: string; dateTo?: string; limit?: number }) {
    const where: any = { cameraId: In([...ACTIVE_CAMERA_IDS]) };
    if (query.patronId) {
      where.patronId = query.patronId;
    }
    if (query.dateFrom || query.dateTo) {
      const from = query.dateFrom ? new Date(query.dateFrom) : new Date('1970-01-01T00:00:00Z');
      const to = query.dateTo ? new Date(query.dateTo) : new Date();
      where.accessTime = Between(from, to);
    }
    const logs = await logRepo().find({
      where,
      order: { accessTime: 'DESC' },
      take: Math.min(query.limit || 200, 1000),
    });
    return enrichLogs(logs);
  }

  async getActive() {
    const states = await stateRepo().find({
      where: { currentStatus: 'inside' },
      order: { lastEntryAt: 'DESC' },
    });
    const userMap = await users.getUsers(states.map((state) => state.patronId));
    return states
      .filter((state) => !state.lastEntryCamera || ACTIVE_CAMERA_IDS.includes(state.lastEntryCamera as any))
      .map((state) => {
        const user = userMap.get(state.patronId);
        return {
          id: state.patronId,
          patron_id: state.patronId,
          full_name: user?.fullName || null,
          fullName: user?.fullName || null,
          email: user?.email || null,
          student_code: user?.studentCode || null,
          studentCode: user?.studentCode || null,
          current_status: state.currentStatus,
          currentStatus: state.currentStatus,
          last_entry_at: state.lastEntryAt,
          lastEntryAt: state.lastEntryAt,
          last_entry_camera: state.lastEntryCamera,
          lastEntryCamera: state.lastEntryCamera,
        };
      });
  }

  async getFrequency(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, Math.min(days, 31)));
    const rows = await logRepo()
      .createQueryBuilder('log')
      .select(`DATE_TRUNC('day', log.accessTime)`, 'date')
      .addSelect('log.accessType', 'access_type')
      .addSelect('COUNT(*)', 'count')
      .where('log.accessTime >= :since', { since })
      .andWhere('log.cameraId IN (:...cameraIds)', { cameraIds: ACTIVE_CAMERA_IDS })
      .groupBy('date')
      .addGroupBy('log.accessType')
      .orderBy('date', 'ASC')
      .getRawMany();
    return rows.map((row) => ({
      date: row.date,
      access_type: row.access_type,
      count: Number(row.count),
    }));
  }

  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [activeCount, todayLogs, totalLogs] = await Promise.all([
      stateRepo().count({ where: { currentStatus: 'inside' } }),
      logRepo().find({ where: { accessTime: MoreThanOrEqual(today), cameraId: In([...ACTIVE_CAMERA_IDS]) } }),
      logRepo().count({ where: { cameraId: In([...ACTIVE_CAMERA_IDS]) } }),
    ]);
    const todayEntries = todayLogs.filter((log) => log.accessType === 'entry').length;
    const todayExits = todayLogs.filter((log) => log.accessType === 'exit').length;
    return {
      active_inside: activeCount,
      activeInside: activeCount,
      today_entries: todayEntries,
      todayEntries,
      today_exits: todayExits,
      todayExits,
      today_total: todayLogs.length,
      todayTotal: todayLogs.length,
      total_logs: totalLogs,
      totalLogs,
    };
  }

  async getStatus(patronId: string) {
    const state = await stateRepo().findOne({ where: { patronId } });
    return {
      patron_id: patronId,
      current_status: state?.currentStatus || 'outside',
      currentStatus: state?.currentStatus || 'outside',
      last_entry_at: state?.lastEntryAt || null,
      lastEntryAt: state?.lastEntryAt || null,
      last_entry_camera: state?.lastEntryCamera || null,
      lastEntryCamera: state?.lastEntryCamera || null,
    };
  }

  async setStatus(patronId: string, currentStatus: 'inside' | 'outside', cameraId?: string | null) {
    if (!['inside', 'outside'].includes(currentStatus)) {
      throw new HttpError(400, 'Invalid current_status');
    }
    const accessType: AccessType = currentStatus === 'inside' ? 'entry' : 'exit';
    await this.upsertState(patronId, accessType, cameraId || 'manual', new Date());
    return this.getStatus(patronId);
  }

  private async upsertState(patronId: string, accessType: AccessType, cameraId: string, at: Date) {
    let state = await stateRepo().findOne({ where: { patronId } });
    if (!state) {
      state = stateRepo().create({ patronId, currentStatus: 'outside' });
    }
    if (accessType === 'entry') {
      state.currentStatus = 'inside';
      state.lastEntryAt = at;
      state.lastEntryCamera = cameraId;
    } else {
      state.currentStatus = 'outside';
      state.lastExitAt = at;
      state.lastExitCamera = cameraId;
    }
    await stateRepo().save(state);
  }
}

export const accessService = new AccessService();
