import ExcelJS from 'exceljs';
import { PatronImportService } from '../../services/PatronImportService';
import { User } from '../../entities/User.entity';

jest.mock('../../clients/AmqpClient', () => ({
  amqpClient: {
    publish: jest.fn().mockResolvedValue(true),
  },
}));

describe('PatronImportService', () => {
  let service: PatronImportService;
  let mockPatronRepo: any;
  let mockUserRepo: any;

  beforeEach(() => {
    mockPatronRepo = {
      findByStudentCode: jest.fn(),
      findByEmail: jest.fn(),
      findByCardNumber: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };
    mockUserRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    service = new PatronImportService(mockPatronRepo, mockUserRepo);
  });

  async function createWorkbookBuffer(rows: any[][], headers?: string[]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Patrons');
    ws.addRow(headers || [
      'Mã sinh viên*',
      'Họ và tên*',
      'Lớp',
      'Khóa học / Niên khóa',
      'Email',
      'Số điện thoại',
      'CCCD/CMND',
      'Hạn thẻ (YYYY-MM-DD)',
    ]);
    for (const row of rows) {
      ws.addRow(row);
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  describe('generateTemplate', () => {
    it('creates an excel workbook with exact 8 columns and sample instructions', async () => {
      const wb = await service.generateTemplate();
      const ws = wb.worksheets[0];
      expect(ws).toBeDefined();
      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      headerRow.eachCell((cell) => headers.push(String(cell.value).trim()));

      expect(headers).toContain('Mã sinh viên*');
      expect(headers).toContain('Họ và tên*');
      expect(headers).toContain('Lớp');
      expect(headers).toContain('Khóa học / Niên khóa');
      expect(headers).toContain('Email');
      expect(headers).toContain('Số điện thoại');
      expect(headers).toContain('CCCD/CMND');
      expect(headers).toContain('Hạn thẻ (YYYY-MM-DD)');
      expect(headers.length).toBe(8);
    });
  });

  describe('preview', () => {
    it('throws error for empty file or file with no data rows', async () => {
      const buffer = await createWorkbookBuffer([]);
      await expect(service.preview(buffer)).rejects.toThrow(/không có dữ liệu/i);
    });

    it('previews new patrons and generates default email if empty', async () => {
      mockUserRepo.find.mockResolvedValue([]);

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Nguyễn Văn An', 'DHKTPM18A', '2022-2026', '', '0912345678', '079201001234', ''],
      ]);

      const result = await service.preview(buffer);
      expect(result.total_rows).toBe(1);
      expect(result.summary.new).toBe(1);
      expect(result.summary.exists).toBe(0);
      expect(result.summary.error).toBe(0);

      const row = result.preview[0];
      expect(row.student_code).toBe('20112233');
      expect(row.full_name).toBe('Nguyễn Văn An');
      expect(row.email).toBe('20112233@library.local');
      expect(row.membership_expiry).toBe('2026-09-01');
      expect(row.status).toBe('new');
    });

    it('marks duplicate student code in file as error/duplicate_in_file', async () => {
      mockUserRepo.find.mockResolvedValue([]);

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Nguyễn Văn An', 'DHKTPM18A', '2022-2026', 'an1@gmail.com', '0912345678', '', ''],
        ['20112233', 'Nguyễn Văn Bình', 'DHKTPM18B', '2022-2026', 'an2@gmail.com', '0987654321', '', ''],
      ]);

      const result = await service.preview(buffer);
      expect(result.summary.error).toBe(2);
      expect(result.preview[0].status).toBe('error');
      expect(result.preview[0].errors).toContain('duplicate_in_file');
      expect(result.preview[1].status).toBe('error');
      expect(result.preview[1].errors).toContain('duplicate_in_file');
    });

    it('marks invalid phone number as error/invalid_phone', async () => {
      mockUserRepo.find.mockResolvedValue([]);

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Nguyễn Văn An', 'DHKTPM18A', '2022-2026', '', '012345', '', ''],
        ['20112234', 'Trần Văn Bình', 'DHKTPM18A', '2022-2026', '', '1234567890', '', ''],
      ]);

      const result = await service.preview(buffer);
      expect(result.summary.error).toBe(2);
      expect(result.preview[0].errors).toContain('invalid_phone');
      expect(result.preview[1].errors).toContain('invalid_phone');
    });

    it('marks student existing in DB as status=exists', async () => {
      mockUserRepo.find.mockResolvedValue([
        {
          id: 'u-1',
          studentCode: '20112233',
          email: '20112233@library.local',
          cardNumber: 'THV-20112233',
          role: 'patron',
        } as User,
      ]);

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Nguyễn Văn An', 'DHKTPM18A', '2022-2026', '', '0912345678', '', ''],
      ]);

      const result = await service.preview(buffer);
      expect(result.summary.exists).toBe(1);
      expect(result.preview[0].status).toBe('exists');
    });

    it('detects duplicate email or identity with existing users in DB', async () => {
      mockUserRepo.find.mockResolvedValue([
        {
          id: 'u-staff',
          studentCode: null,
          email: 'staff@iuh.edu.vn',
          identityNumber: '079201009999',
          cardNumber: null,
          role: 'staff',
        } as User,
      ]);

      const buffer = await createWorkbookBuffer([
        ['20112235', 'Lê Văn C', 'DHKTPM18A', '2022-2026', 'staff@iuh.edu.vn', '0912345678', '079201001111', ''],
        ['20112236', 'Phạm Văn D', 'DHKTPM18A', '2022-2026', 'd@gmail.com', '0912345678', '079201009999', ''],
      ]);

      const result = await service.preview(buffer);
      expect(result.summary.error).toBe(2);
      expect(result.preview[0].errors).toContain('duplicate_email');
      expect(result.preview[1].errors).toContain('duplicate_identity');
    });

    it('parses expiry date correctly from column, course, or defaults to 4 years', async () => {
      mockUserRepo.find.mockResolvedValue([]);

      const buffer = await createWorkbookBuffer([
        ['20112201', 'SV 1', 'L1', '', '', '0912345678', '', '2028-06-30'],
        ['20112202', 'SV 2', 'L1', '2023-2027', '', '0912345678', '', ''],
        ['20112203', 'SV 3', 'L1', '', '', '0912345678', '', ''],
      ]);

      const result = await service.preview(buffer);
      expect(result.preview[0].membership_expiry).toBe('2028-06-30');
      expect(result.preview[1].membership_expiry).toBe('2027-09-01');
      const expectedYear = new Date().getFullYear() + 4;
      expect(result.preview[2].membership_expiry).toBe(`${expectedYear}-09-01`);
    });
  });

  describe('execute', () => {
    it('mode=skip: skips existing patrons and imports new patrons with default password and THV card', async () => {
      mockUserRepo.find.mockResolvedValue([
        {
          id: 'u-existing',
          studentCode: '20112233',
          email: '20112233@library.local',
          cardNumber: 'THV-20112233',
          role: 'patron',
        } as User,
      ]);
      mockPatronRepo.create.mockResolvedValue({ id: 'u-new' });

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Nguyễn Văn An', 'DHKTPM18A', '2022-2026', '', '0912345678', '', ''],
        ['20112234', 'Trần Văn Bình', 'DHKTPM18A', '2022-2026', '', '0987654321', '', ''],
      ]);

      const result = await service.execute(buffer, 'skip');
      expect(result.total_rows).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors.length).toBe(0);

      expect(mockPatronRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          studentCode: '20112234',
          fullName: 'Trần Văn Bình',
          cardNumber: 'THV-20112234',
          email: '20112234@library.local',
          phone: '0987654321',
          status: 'active',
          currentStatus: 'outside',
          passwordAutoGenerated: true,
        }),
      );
    });

    it('mode=update: updates existing patron without changing password, card, or full_name', async () => {
      const existingUser = {
        id: 'u-existing',
        studentCode: '20112233',
        fullName: 'Tên Gốc Không Đổi',
        cardNumber: 'THV-20112233',
        email: 'old@email.com',
        phone: '0900000000',
        className: 'OldClass',
        course: 'OldCourse',
        passwordHash: 'secret_hash_not_changed',
        passwordAutoGenerated: false,
        role: 'patron',
      } as User;

      mockUserRepo.find.mockResolvedValue([existingUser]);
      mockPatronRepo.update.mockResolvedValue({ id: 'u-existing' });

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Tên Mới Trong Excel Bị Bỏ Qua', 'DHKTPM18B', '2022-2026', 'new@email.com', '0912345678', '', '2027-09-01'],
      ]);

      const result = await service.execute(buffer, 'update');
      expect(result.total_rows).toBe(1);
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);

      expect(mockPatronRepo.update).toHaveBeenCalledWith('u-existing', {
        className: 'DHKTPM18B',
        course: '2022-2026',
        phone: '0912345678',
        email: 'new@email.com',
        membershipExpiry: '2027-09-01',
      });
      // full_name, cardNumber, password must NOT be touched
      expect(mockPatronRepo.update).not.toHaveBeenCalledWith(
        'u-existing',
        expect.objectContaining({ fullName: 'Tên Mới Trong Excel Bị Bỏ Qua' }),
      );
    });

    it('mode=update: keeps existing email/phone/class when Excel cells are empty', async () => {
      const existingUser = {
        id: 'u-existing',
        studentCode: '20112233',
        fullName: 'Tên Gốc',
        cardNumber: 'THV-20112233',
        email: 'real@email.com',
        phone: '0900000000',
        className: 'OldClass',
        course: 'OldCourse',
        membershipExpiry: '2025-09-01',
        role: 'patron',
      } as User;

      mockUserRepo.find.mockResolvedValue([existingUser]);
      mockPatronRepo.update.mockResolvedValue({ id: 'u-existing' });

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Tên Gốc', '', '', '', '', '', ''],
      ]);

      const result = await service.execute(buffer, 'update');
      expect(result.updated).toBe(1);
      expect(result.errors.length).toBe(0);

      // Empty cells must NOT overwrite real data (no email => no email key at all)
      expect(mockPatronRepo.update).toHaveBeenCalledWith('u-existing', {});
      expect(mockPatronRepo.update).not.toHaveBeenCalledWith(
        'u-existing',
        expect.objectContaining({ email: expect.anything() }),
      );
    });

    it('mode=update: updates only explicitly provided fields', async () => {
      const existingUser = {
        id: 'u-existing',
        studentCode: '20112233',
        fullName: 'Tên Gốc',
        cardNumber: 'THV-20112233',
        email: 'real@email.com',
        phone: '0900000000',
        className: 'OldClass',
        course: 'OldCourse',
        membershipExpiry: '2025-09-01',
        role: 'patron',
      } as User;

      mockUserRepo.find.mockResolvedValue([existingUser]);
      mockPatronRepo.update.mockResolvedValue({ id: 'u-existing' });

      const buffer = await createWorkbookBuffer([
        ['20112233', 'Tên Gốc', '', '', '', '0911111111', '', ''],
      ]);

      const result = await service.execute(buffer, 'update');
      expect(result.updated).toBe(1);
      expect(mockPatronRepo.update).toHaveBeenCalledWith('u-existing', {
        phone: '0911111111',
      });
    });

    it('normalizes VN phone typed as Excel number (leading zero lost) by restoring 0', async () => {
      mockUserRepo.find.mockResolvedValue([]);

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Patrons');
      ws.addRow([
        'Mã sinh viên*',
        'Họ và tên*',
        'Lớp',
        'Khóa học / Niên khóa',
        'Email',
        'Số điện thoại',
        'CCCD/CMND',
        'Hạn thẻ (YYYY-MM-DD)',
      ]);
      const dataRow = ws.addRow(['20112237', 'Võ Văn E', 'DHKTPM18A', '2022-2026', '', 912345678, '', '']);
      dataRow.getCell(6).numFmt = '0';
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());

      const result = await service.preview(buffer);
      expect(result.summary.error).toBe(0);
      expect(result.preview[0].status).toBe('new');
      expect(result.preview[0].phone).toBe('0912345678');
    });

    it('maps DB unique violation on create to duplicate_email instead of raw DB error', async () => {
      mockUserRepo.find.mockResolvedValue([]);
      const dbErr: any = new Error('duplicate key value violates unique constraint "UQ_users_email"');
      dbErr.code = '23505';
      dbErr.detail = 'Key (email)=(taken@gmail.com) already exists.';
      mockPatronRepo.create.mockRejectedValue(dbErr);

      const buffer = await createWorkbookBuffer([
        ['20112238', 'Ngô Văn F', 'DHKTPM18A', '2022-2026', 'taken@gmail.com', '0912345678', '', ''],
      ]);

      const result = await service.execute(buffer, 'skip');
      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].code).toBe('duplicate_email');
      expect(result.errors[0].message).not.toMatch(/duplicate key value/i);
    });
  });
});
