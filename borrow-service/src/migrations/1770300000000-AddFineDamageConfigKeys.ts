import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills the fine-category keys introduced for return-receipt-fine
 * (damage fees + lock threshold) so they are editable in settings.
 * Idempotent: existing rows are never overwritten.
 */
export class AddFineDamageConfigKeys1770300000000 implements MigrationInterface {
  name = 'AddFineDamageConfigKeys1770300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = [
      ['fine', 'damage_fee_pct', '{"minor":30,"major":70,"lost":100}', 'Tỉ lệ phí hư hỏng (%)', 'Phần trăm giá bìa tính phí hư hỏng theo mức: hư nhẹ / hư nặng / mất'],
      ['fine', 'damage_fee_fixed', '{"minor":5000,"major":10000,"lost":10000}', 'Phí cố định hư hỏng (VND)', 'Phí cố định cộng thêm theo mức hư nhẹ / hư nặng / mất (VND)'],
      ['fine', 'fallback_book_price', '100000', 'Giá bìa mặc định (VND)', 'Giá dùng khi sách chưa có giá bìa để tính phí hư hỏng'],
      ['fine', 'fine_lock_threshold_days', '30', 'Ngưỡng khóa thẻ (ngày)', 'Số ngày quá hạn chưa trả thì tự động khóa thẻ độc giả'],
    ];
    for (const [category, key, value, label, description] of rows) {
      await queryRunner.query(
        `INSERT INTO system_configs (category, config_key, config_value, label, description)
         SELECT $1, $2, $3::jsonb, $4, $5
         WHERE NOT EXISTS (SELECT 1 FROM system_configs WHERE category = $1 AND config_key = $2)`,
        [category, key, value, label, description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM system_configs
      WHERE category = 'fine' AND config_key IN ('damage_fee_pct', 'damage_fee_fixed', 'fallback_book_price', 'fine_lock_threshold_days')
    `);
  }
}
