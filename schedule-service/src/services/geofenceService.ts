import { Repository, In } from 'typeorm';
import { AppDataSource } from '../data-source';
import { GeofenceConfig, LibraryZone, StaffSchedule, ScheduleAuditLog } from '../entities';
import { BadRequestError, NotFoundError } from '../errors';
import { evaluateGeofence, isValidCoordinate, GPS_TOLERANCE_METERS } from '../utils/geofence';
import { writeAuditLog } from './scheduleAudit';
import { requireOwnedSchedule } from './scheduleGuards';

/**
 * Kết quả đối chiếu vị trí thiết bị với geofence của khu vực được phân công.
 * `verified` = true chỉ khi toạ độ GPS nằm trong tâm + bán kính cho phép.
 */
export interface CheckInLocationVerification {
  verified: boolean;
  method: string;
  distanceMeters: number | null;
  radiusMeters: number | null;
  zoneId: string | null;
  reason: string;
}

/**
 * GeofenceService — CRUD + verification for check-in location fencing.
 * Single responsibility: manage GeofenceConfig rows (global + per-zone) and
 * decide whether a device GPS position falls inside the allowed radius.
 */
export class GeofenceService {
  private geofence: Repository<GeofenceConfig>;
  private zones: Repository<LibraryZone>;
  private schedules: Repository<StaffSchedule>;
  private audit: Repository<ScheduleAuditLog>;

  constructor(
    geofence: Repository<GeofenceConfig> = AppDataSource.getRepository(GeofenceConfig),
    zones: Repository<LibraryZone> = AppDataSource.getRepository(LibraryZone),
    schedules: Repository<StaffSchedule> = AppDataSource.getRepository(StaffSchedule),
    audit: Repository<ScheduleAuditLog> = AppDataSource.getRepository(ScheduleAuditLog),
  ) {
    this.geofence = geofence;
    this.zones = zones;
    this.schedules = schedules;
    this.audit = audit;
  }

  async setGeofence(actorId: string, body: { zoneId?: string | null; latitude: number; longitude: number; radiusMeters?: number; addressHint?: string | null; allowedWifiSsids?: string[] | null; isGlobal?: boolean }) {
    const isGlobal = body.isGlobal === true;

    if (isGlobal) {
      // Chỉ cho phép 1 bản ghi global tại một thời điểm: vô hiệu hóa các global cũ.
      await this.geofence.update({ isGlobal: true, isActive: true }, { isActive: false, isGlobal: false });
      const config = await this.geofence.save(this.geofence.create({
        zoneId: null,
        isGlobal: true,
        isActive: true,
        latitude: body.latitude,
        longitude: body.longitude,
        radiusMeters: body.radiusMeters ?? 100,
        addressHint: body.addressHint ?? 'Trung tâm Thư viện IUH (tổng hợp)',
        allowedWifiSsids: body.allowedWifiSsids ?? null,
      }));
      await writeAuditLog(this.audit, 'geofence.created', 'geofence_config', config.id, actorId, { ...body, isGlobal: true });
      return config;
    }

    // Bản ghi theo khu vực: bắt buộc zona tồn tại.
    if (!body.zoneId) throw new BadRequestError('zoneId là bắt buộc khi cấu hình geofence theo khu vực');
    const zone = await this.zones.findOneBy({ id: body.zoneId, isActive: true });
    if (!zone) throw new NotFoundError('Zone not found');
    const existing = await this.geofence.findOneBy({ zoneId: body.zoneId, isGlobal: false });
    if (existing) {
      existing.latitude = body.latitude;
      existing.longitude = body.longitude;
      existing.radiusMeters = body.radiusMeters ?? existing.radiusMeters;
      existing.addressHint = body.addressHint ?? existing.addressHint;
      existing.allowedWifiSsids = body.allowedWifiSsids !== undefined ? body.allowedWifiSsids : existing.allowedWifiSsids;
      existing.isGlobal = false;
      await this.geofence.save(existing);
      await writeAuditLog(this.audit, 'geofence.updated', 'geofence_config', existing.id, actorId, body);
      return existing;
    }
    const config = await this.geofence.save(this.geofence.create({
      ...body,
      isGlobal: false,
      radiusMeters: body.radiusMeters ?? 100,
    }));
    await writeAuditLog(this.audit, 'geofence.created', 'geofence_config', config.id, actorId, body);
    return config;
  }

  async listGeofenceConfigs() {
    const configs = await this.geofence.find({ where: { isActive: true } });
    const zoneIds = configs.map((c) => c.zoneId).filter((id): id is string => id != null);
    const zones = zoneIds.length ? await this.zones.findBy({ id: In(zoneIds) }) : [];
    return configs.map((c) => ({ ...c, zone: zones.find((z) => z.id === c.zoneId) ?? null }));
  }

  async deleteGeofence(actorId: string, zoneId: string) {
    const config = await this.geofence.findOneBy({ zoneId });
    if (!config) throw new NotFoundError('Geofence config not found');
    config.isActive = false;
    await this.geofence.save(config);
    await writeAuditLog(this.audit, 'geofence.deleted', 'geofence_config', config.id, actorId, { zoneId });
    return { deleted: true, zoneId };
  }

  /**
   * Lấy bản ghi địa điểm chung (global geofence) — toạ độ Trung tâm Thư viện
   * duy nhất cho toàn hệ thống. Trả về null nếu chưa cấu hình.
   */
  private async getGlobalGeofence() {
    return this.geofence.findOneBy({ isGlobal: true, isActive: true });
  }

  /**
   * Trả về geofence để client vẽ bản đồ và tự đánh giá vị trí trước khi gọi check-in.
   * Ưu tiên bản ghi địa điểm chung (global). Nếu chưa có global, quay về bản ghi
   * theo khu vực phân công (hỗ trợ backward-compat). Chỉ nhân viên sở hữu phân
   * công mới đọc được.
   *
   * Lưu ý: đây chỉ là dữ liệu hiển thị. Việc quyết định cho check-in vẫn do
   * `verifyCheckInGeofence` tính lại trên server.
   */
  async getAssignmentGeofence(staffId: string, assignmentId: string) {
    const schedule = await requireOwnedSchedule(this.schedules, staffId, assignmentId);
    const zoneId = schedule.zoneId ?? null;
    const unconfigured = {
      zoneId,
      configured: false as const,
      latitude: null,
      longitude: null,
      radiusMeters: null,
      toleranceMeters: GPS_TOLERANCE_METERS,
    };

    // Ưu tiên địa điểm chung (global) — 1 tọa độ thống nhất cho toàn hệ thống.
    const global = await this.getGlobalGeofence();
    if (global) {
      return {
        zoneId,
        configured: true as const,
        latitude: global.latitude,
        longitude: global.longitude,
        radiusMeters: global.radiusMeters,
        toleranceMeters: GPS_TOLERANCE_METERS,
        isGlobal: true as const,
      };
    }

    if (!zoneId) return unconfigured;

    const geofence = await this.geofence.findOneBy({ zoneId, isActive: true });
    if (!geofence) return unconfigured;

    return {
      zoneId,
      configured: true as const,
      latitude: geofence.latitude,
      longitude: geofence.longitude,
      radiusMeters: geofence.radiusMeters,
      toleranceMeters: GPS_TOLERANCE_METERS,
      isGlobal: false as const,
    };
  }

  /**
   * Đối chiếu vị trí GPS của thiết bị với geofence hiệu lực (global trước, sau đó
   * theo khu vực phân công). Ném BadRequestError nếu thiếu/toạ độ sai hoặc ở ngoài
   * bán kính; ghi audit cho từng nhánh thất bại.
   */
  async verifyCheckInGeofence(
    schedule: StaffSchedule,
    staffId: string,
    input: { lat?: number; lng?: number; method: string }
  ): Promise<CheckInLocationVerification> {
    const { lat, lng, method } = input;
    const zoneId = schedule.zoneId ?? null;

    // Ưu tiên địa điểm chung (global) — 1 tọa độ Trung tâm Thư viện duy nhất.
    // Nếu chưa có global, quay về bản ghi theo khu vực phân công (backward-compat).
    let geofence = await this.getGlobalGeofence();
    let source = 'global';
    if (!geofence) {
      if (!zoneId) {
        return { verified: false, method, distanceMeters: null, radiusMeters: null, zoneId, reason: 'Chưa cấu hình địa điểm điểm danh chung' };
      }
      geofence = await this.geofence.findOneBy({ zoneId, isActive: true });
      source = 'zone';
    }
    if (!geofence) {
      await writeAuditLog(this.audit, 'attendance.check_in_unconfigured_geofence', 'staff_schedule', schedule.id, staffId, { zoneId, source });
      return { verified: false, method, distanceMeters: null, radiusMeters: null, zoneId, reason: 'Chưa cấu hình địa điểm điểm danh chung' };
    }

    const radiusMeters = geofence.radiusMeters;

    if (!isValidCoordinate(lat, lng)) {
      await writeAuditLog(this.audit, 'attendance.check_in_missing_location', 'staff_schedule', schedule.id, staffId, { zoneId, method });
      throw new BadRequestError(
        'Không xác định được vị trí GPS của thiết bị. Vui lòng bật định vị và thử lại để điểm danh.'
      );
    }

    const evaluation = evaluateGeofence(lat as number, lng as number, geofence);
    const distanceMeters = Math.round(evaluation.distanceMeters);

    if (evaluation.allowed) {
      return { verified: true, method, distanceMeters, radiusMeters, zoneId, reason: evaluation.reason };
    }

    await writeAuditLog(this.audit, 'attendance.check_in_failed_geofence', 'staff_schedule', schedule.id, staffId, {
      latitude: lat,
      longitude: lng,
      distance: distanceMeters,
      allowedRadius: radiusMeters,
    });

    throw new BadRequestError(
      `Bạn đang ở ngoài khu vực làm việc: cách ${distanceMeters}m, vượt ${evaluation.overflowMeters}m ngoài bán kính ${radiusMeters}m cho phép. Vui lòng di chuyển vào trong khu vực làm việc rồi thử lại.`
    );
  }
}
