import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Clarifies the two borrow-limit descriptions so admins can tell
 * the per-patron total apart from the per-slip cap.
 * Idempotent: only rewrites the exact legacy descriptions.
 */
export class ClarifyBorrowLimitDescriptions1770400000000 implements MigrationInterface {
  name = 'ClarifyBorrowLimitDescriptions1770400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE system_configs SET description = 'Tổng số sách một độc giả được giữ cùng lúc (cộng dồn mọi phiếu chưa trả)'
       WHERE category = 'borrow' AND config_key = 'max_borrow_books'
       AND description = 'Số lượng sách có thể mượn cùng lúc'`,
    );
    await queryRunner.query(
      `UPDATE system_configs SET description = 'Số cuốn tối đa trong một phiếu mượn (buộc chia nhỏ giao dịch khi tổng hạn mức lớn)'
       WHERE category = 'borrow' AND config_key = 'max_borrow_books_per_slip'
       AND description = 'Số lượng sách tối đa trên một phiếu mượn'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE system_configs SET description = 'Số lượng sách có thể mượn cùng lúc'
       WHERE category = 'borrow' AND config_key = 'max_borrow_books'`,
    );
    await queryRunner.query(
      `UPDATE system_configs SET description = 'Số lượng sách tối đa trên một phiếu mượn'
       WHERE category = 'borrow' AND config_key = 'max_borrow_books_per_slip'`,
    );
  }
}
