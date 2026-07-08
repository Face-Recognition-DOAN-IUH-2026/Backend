import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSystemConfigsTable1720500000000 implements MigrationInterface {
  name = 'CreateSystemConfigsTable1720500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS system_configs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        category varchar(50) NOT NULL,
        config_key varchar(100) NOT NULL,
        config_value jsonb NOT NULL DEFAULT '{}'::jsonb,
        label varchar(200) NOT NULL,
        description text,
        is_encrypted boolean DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by uuid,
        UNIQUE (category, config_key)
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_system_configs_category ON system_configs(category)`);

    await queryRunner.query(`
      INSERT INTO system_configs (category, config_key, config_value, label, description) VALUES
      ('borrow', 'max_borrow_days', '14', 'Số ngày mượn tối đa', 'Thời gian mượn sách tối đa (ngày)'),
      ('borrow', 'max_borrow_books', '3', 'Số sách mượn tối đa', 'Số lượng sách có thể mượn cùng lúc'),
      ('borrow', 'max_borrow_books_per_slip', '5', 'Số sách tối đa mỗi phiếu', 'Số lượng sách tối đa trên một phiếu mượn'),
      ('borrow', 'max_renewals', '1', 'Số lần gia hạn tối đa', 'Số lần gia hạn sách tối đa'),
      ('fine', 'fine_brackets', '[{"from":1,"to":7,"amount":10000},{"from":8,"to":14,"amount":20000},{"from":15,"to":30,"amount":50000},{"from":31,"to":null,"amount":100000}]', 'Biểu phí phạt theo bậc', 'Các mức phí phạt dựa trên số ngày quá hạn'),
      ('fine', 'fine_per_day', '5000', 'Phí phạt mỗi ngày', 'Phí phạt tuyến tính mỗi ngày quá hạn (VND)'),
      ('smtp', 'host', '"smtp.gmail.com"', 'SMTP Host', 'Địa chỉ host máy chủ SMTP'),
      ('smtp', 'port', '587', 'SMTP Port', 'Cổng kết nối SMTP'),
      ('smtp', 'secure', 'false', 'SMTP SSL/TLS', 'Bật SSL/TLS cho kết nối SMTP (dùng cho port 465)'),
      ('smtp', 'user', '""', 'SMTP Username', 'Tên đăng nhập SMTP'),
      ('smtp', 'pass', '""', 'SMTP Password', 'Mật khẩu SMTP'),
      ('smtp', 'from', '"Thu Vien IUH <noreply@iuh.edu.vn>"', 'Địa chỉ email gửi', 'Địa chỉ email người gửi'),
      ('automation', 'overdue_cron', '"0 9 * * *"', 'Cron kiểm tra quá hạn', 'Lịch chạy kiểm tra sách quá hạn'),
      ('automation', 'overdue_days_before', '3', 'Nhắc trước ngày', 'Số ngày trước hạn để gửi nhắc nhở'),
      ('automation', 'membership_expiry_days_before', '7', 'Nhắc gia hạn thẻ trước', 'Số ngày trước hạn để gửi nhắc gia hạn thẻ'),
      ('automation', 'stale_cleanup_hours', '24', 'Dọn dẹp patron ở lại', 'Số giờ tối đa patron ở lại thư viện trước khi bị dọn dẹp'),
      ('automation', 'notify_roles', '["admin","staff"]', 'Roles nhận thông báo', 'Các role được nhận thông báo hệ thống'),
      ('access', 'max_entry_hours', '24', 'Giờ tối đa trong thư viện', 'Số giờ tối đa cho phép ở lại thư viện')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS system_configs`);
  }
}
