import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BLF-GEO-UNIFIED — thống nhất geofence về 1 tọa độ Trung tâm Thư viện.
 *
 * - Cho phép `zone_id` NULL (bản ghi global không gắn zona nào).
 * - Thêm cột `is_global` đánh dấu bản ghi địa điểm chung cho toàn hệ thống.
 * - Backfill: lấy bản ghi khu vực đầu tiên (tất cả đã có toạ độ trung tâm IUH
 *   giống nhau) làm bản ghi global (zone_id = NULL, is_global = true), các bản
 *   ghi khu vực còn lại đặt is_active = false để tránh trùng lặp.
 */
export class UnifiedGeofence1770800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. zone_id cho phép NULL (bản ghi global không gắn zona).
    await queryRunner.query(
      `ALTER TABLE schedule.geofence_configs ALTER COLUMN zone_id DROP NOT NULL;`,
    );

    // 2. Cột đánh dấu bản ghi địa điểm chung.
    await queryRunner.query(
      `ALTER TABLE schedule.geofence_configs ADD COLUMN IF NOT EXISTS is_global BOOLEAN NOT NULL DEFAULT FALSE;`,
    );

    // 3. Backfill: chọn bản ghi cũ nhất làm global, vô hiệu hóa các bản ghi khu vực còn lại.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
        FROM schedule.geofence_configs
      )
      UPDATE schedule.geofence_configs g
      SET zone_id = NULL,
          is_global = TRUE,
          is_active = TRUE,
          address_hint = COALESCE(g.address_hint, 'Trung tâm Thư viện IUH (tổng hợp)')
      FROM ranked r
      WHERE g.id = r.id AND r.rn = 1;

      UPDATE schedule.geofence_configs
      SET is_active = FALSE
      WHERE is_global = FALSE;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE schedule.geofence_configs DROP COLUMN IF EXISTS is_global;`,
    );
    await queryRunner.query(
      `ALTER TABLE schedule.geofence_configs ALTER COLUMN zone_id SET NOT NULL;`,
    );
  }
}
