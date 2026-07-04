import { Between, In, IsNull, LessThan, MoreThanOrEqual } from 'typeorm';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { AppDataSource } from '../data-source';
import { AccessLog } from '../entities/AccessLog';
import { KioskDevice } from '../entities/KioskDevice';
import { KioskApprovalRequest } from '../entities/KioskApprovalRequest';
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
import { HttpError } from '../../../shared';
import { config } from '../config';

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
    const MAX_INSIDE_HOURS = 24;
    const states = await stateRepo().find({
      where: { currentStatus: 'inside' },
      order: { lastEntryAt: 'DESC' },
    });

    const userMap = await users.getUsers(states.map((state) => state.patronId));

    const now = Date.now();
    const results: any[] = [];
    const staleIds: string[] = [];

    for (const state of states) {
      const user = userMap.get(state.patronId);

      if (!user || user.status === 'deleted') {
        staleIds.push(state.patronId);
        continue;
      }

      const entryTime = state.lastEntryAt ? new Date(state.lastEntryAt).getTime() : 0;
      const hoursInside = (now - entryTime) / (1000 * 60 * 60);
      if (hoursInside > MAX_INSIDE_HOURS) {
        staleIds.push(state.patronId);
        continue;
      }

      if (state.lastEntryCamera && !ACTIVE_CAMERA_IDS.includes(state.lastEntryCamera as any)) {
        continue;
      }

      results.push({
        id: state.patronId,
        patron_id: state.patronId,
        full_name: user.fullName || null,
        fullName: user.fullName || null,
        email: user.email || null,
        student_code: user.studentCode || null,
        studentCode: user.studentCode || null,
        current_status: state.currentStatus,
        currentStatus: state.currentStatus,
        last_entry_at: state.lastEntryAt,
        lastEntryAt: state.lastEntryAt,
        last_entry_camera: state.lastEntryCamera,
        lastEntryCamera: state.lastEntryCamera,
      });
    }

    if (staleIds.length > 0) {
      stateRepo().update(staleIds, { currentStatus: 'outside' }).catch(err => {
        console.error('[AccessService] Stale patron cleanup failed:', err);
      });
    }

    return results;
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

    const activeList = await this.getActive();
    const activeCount = activeList.length;

    const entryExitCounts = await logRepo()
      .createQueryBuilder('log')
      .select('log.access_type', 'accessType')
      .addSelect('COUNT(*)', 'count')
      .where('log.access_time >= :today', { today })
      .andWhere('log.camera_id IN (:...cameraIds)', { cameraIds: ACTIVE_CAMERA_IDS })
      .groupBy('log.access_type')
      .getRawMany();

    const todayEntries = Number(entryExitCounts.find(c => c.accessType === 'entry')?.count || 0);
    const todayExits = Number(entryExitCounts.find(c => c.accessType === 'exit')?.count || 0);

    return {
      active_inside: activeCount,
      activeInside: activeCount,
      today_entries: todayEntries,
      todayEntries,
      today_exits: todayExits,
      todayExits,
      today_total: todayEntries + todayExits,
      todayTotal: todayEntries + todayExits,
    };
  }

  async getStatus(patronId: string) {
    let state = await stateRepo().findOne({ where: { patronId } });
    if (!state) {
      state = stateRepo().create({ patronId, currentStatus: 'outside', lastEntryAt: null, lastEntryCamera: null });
      await stateRepo().save(state);
    }
    return {
      patron_id: patronId,
      current_status: state.currentStatus,
      currentStatus: state.currentStatus,
      last_entry_at: state.lastEntryAt,
      lastEntryAt: state.lastEntryAt,
      last_entry_camera: state.lastEntryCamera,
      lastEntryCamera: state.lastEntryCamera,
    };
  }

  async setStatus(patronId: string, currentStatus: 'inside' | 'outside' | 'pending', cameraId?: string | null) {
    if (!['inside', 'outside', 'pending'].includes(currentStatus)) {
      throw new HttpError(400, 'Invalid current_status');
    }
    const accessType: AccessType = currentStatus === 'inside' ? 'entry' : 'exit';
    await this.upsertState(patronId, accessType, cameraId || 'manual', new Date());
    return this.getStatus(patronId);
  }

  async findKioskDevice(deviceId: string): Promise<KioskDevice | null> {
    const repo = AppDataSource.getRepository(KioskDevice);
    return repo.findOne({ where: { id: deviceId, isActive: true } });
  }

  async verifyKioskIp(ip: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(KioskDevice);
    const device = await repo.findOne({ where: { ipAddress: ip, isActive: true } });
    return !!device;
  }

  async recordKioskPresence(patronId: string, studentCode: string, deviceId: string): Promise<any> {
    const state = await this.getStatus(patronId);
    if (state.currentStatus === 'inside' || state.currentStatus === 'pending') {
      return { ...state, message: 'Độc giả đã có mặt trong thư viện hoặc đang xác thực', skipped: true };
    }
    await this.setStatus(patronId, 'pending', 'kiosk');
    return { ...await this.getStatus(patronId), message: 'Đang chờ xác thực', skipped: false };
  }

  async confirmEntry(patronId: string): Promise<any> {
    const state = await this.getStatus(patronId);
    if (state.currentStatus !== 'pending') {
      return { ...state, message: 'Trạng thái không phải pending, bỏ qua', skipped: true };
    }
    await this.upsertState(patronId, 'entry', 'face-verify', new Date());
    return { ...await this.getStatus(patronId), message: 'Xác nhận vào thư viện thành công' };
  }

  async revertPending(patronId: string): Promise<any> {
    const state = await this.getStatus(patronId);
    if (state.currentStatus !== 'pending') {
      return { ...state, message: 'Trạng thái không phải pending, bỏ qua', skipped: true };
    }
    await this.upsertState(patronId, 'exit', 'verify-failed', new Date());
    return { ...await this.getStatus(patronId), message: 'Hoàn tác trạng thái pending thành công' };
  }

  async cleanupExpiredPending(expiredBefore: Date): Promise<{ cleaned: number }> {
    const repo = stateRepo();
    const pending = await repo.find({ where: { currentStatus: 'pending' as any } });
    const expired = pending.filter(s => s.updatedAt < expiredBefore);
    if (expired.length === 0) return { cleaned: 0 };
    for (const state of expired) {
      await this.upsertState(state.patronId, 'exit', 'timeout', new Date());
    }
    return { cleaned: expired.length };
  }

  private async generateEventCode(): Promise<string> {
    const repo = AppDataSource.getRepository(KioskApprovalRequest);
    for (let attempt = 0; attempt < 5; attempt++) {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const code = letters[Math.floor(Math.random() * 26)] + String(Math.floor(Math.random() * 900) + 100);
      const existing = await repo.findOne({ where: { eventCode: code } });
      if (!existing) return code;
    }
    const latest = await repo.find({ order: { createdAt: 'DESC' }, take: 1 });
    const lastCode = latest.length > 0 ? latest[0].eventCode : 'A000';
    const num = parseInt(lastCode.substring(1), 10) + 1;
    return lastCode[0] + String(num).padStart(3, '0');
  }

  async createApprovalRequest(input: {
    kioskDeviceId: string;
    patronId?: string | null;
    patronStudentCode?: string | null;
    failImageUrl?: string | null;
    isbns?: string | null;
  }) {
    const repo = AppDataSource.getRepository(KioskApprovalRequest);
    const eventCode = await this.generateEventCode();
    const deviceAuthToken = jwt.sign(
      {
        sub: eventCode,
        event_code: eventCode,
        patron_id: input.patronId,
        student_code: input.patronStudentCode,
        isbns: input.isbns || null,
        fail_image_url: input.failImageUrl || null,
      },
      config.serviceJwtSecret,
      { expiresIn: 300 }
    );
    const expiresAt = new Date(Date.now() + 300000);
    const entity = repo.create({
      eventCode,
      kioskDeviceId: input.kioskDeviceId,
      patronId: input.patronId || null,
      patronStudentCode: input.patronStudentCode || null,
      failImageUrl: input.failImageUrl || null,
      isbns: input.isbns || null,
      deviceAuthToken,
      status: 'pending',
      expiresAt,
    });
    const saved = await repo.save(entity);
    return {
      id: saved.id,
      event_code: saved.eventCode,
      device_auth_token: saved.deviceAuthToken,
      status: saved.status,
      expires_at: saved.expiresAt.toISOString(),
    };
  }

  async getPendingApprovalRequests() {
    const repo = AppDataSource.getRepository(KioskApprovalRequest);
    const rows = await repo.find({
      where: { status: 'pending', expiresAt: MoreThanOrEqual(new Date()) },
      order: { createdAt: 'DESC' },
    });
    return rows.map(r => ({
      id: r.id,
      event_code: r.eventCode,
      kiosk_device_id: r.kioskDeviceId,
      patron_id: r.patronId,
      patron_student_code: r.patronStudentCode,
      fail_image_url: r.failImageUrl,
      isbns: r.isbns,
      status: r.status,
      created_at: r.createdAt.toISOString(),
      expires_at: r.expiresAt.toISOString(),
    }));
  }

  async getApprovalRequest(eventCode: string) {
    const repo = AppDataSource.getRepository(KioskApprovalRequest);
    const record = await repo.findOne({ where: { eventCode } });
    if (!record) throw new HttpError(404, 'Approval request not found');
    return {
      id: record.id,
      event_code: record.eventCode,
      kiosk_device_id: record.kioskDeviceId,
      patron_id: record.patronId,
      patron_student_code: record.patronStudentCode,
      fail_image_url: record.failImageUrl,
      isbns: record.isbns,
      status: record.status,
      created_at: record.createdAt.toISOString(),
      expires_at: record.expiresAt.toISOString(),
      approved_by: record.approvedBy,
      approved_at: record.approvedAt?.toISOString() || null,
      reject_reason: record.rejectReason,
    };
  }

  async approveRequest(eventCode: string, approvedBy: string) {
    const repo = AppDataSource.getRepository(KioskApprovalRequest);
    const record = await repo.findOne({ where: { eventCode } });
    if (!record) throw new HttpError(404, 'Approval request not found');
    if (record.status !== 'pending') throw new HttpError(400, `Request is already ${record.status}`);
    if (record.expiresAt < new Date()) throw new HttpError(400, 'Approval request has expired');

    record.status = 'approved';
    record.approvedBy = approvedBy;
    record.approvedAt = new Date();
    await repo.save(record);

    return { status: 'approved', event_code: record.eventCode };
  }

  async rejectRequest(eventCode: string, approvedBy: string, reason?: string) {
    const repo = AppDataSource.getRepository(KioskApprovalRequest);
    const record = await repo.findOne({ where: { eventCode } });
    if (!record) throw new HttpError(404, 'Approval request not found');
    if (record.status !== 'pending') throw new HttpError(400, `Request is already ${record.status}`);
    if (record.expiresAt < new Date()) throw new HttpError(400, 'Approval request has expired');

    record.status = 'rejected';
    record.approvedBy = approvedBy;
    record.rejectReason = reason || null;
    await repo.save(record);

    return { status: 'rejected', event_code: record.eventCode };
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

    const { amqpClient } = require('../clients/AmqpClient');
    amqpClient.publish('user.access.status_changed', {
      patronId,
      currentStatus: state.currentStatus,
      lastEntryAt: state.lastEntryAt ? state.lastEntryAt.toISOString() : null,
      lastEntryCamera: state.lastEntryCamera || null,
      lastExitAt: state.lastExitAt ? state.lastExitAt.toISOString() : null,
      lastExitCamera: state.lastExitCamera || null,
    }).catch((err: any) => console.error('[AMQP] Failed to publish status changed event:', err.message));
  }
}

export const accessService = new AccessService();
