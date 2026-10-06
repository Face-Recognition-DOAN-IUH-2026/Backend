import ExcelJS from 'exceljs';
import bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import { User, UserRole } from '../entities/User.entity';
import { PatronRepository } from '../repositories/PatronRepository';
import { BadRequestError } from '../errors';

export interface ParsedPatronRow {
  row: number;
  student_code: string;
  full_name: string;
  class_name: string | null;
  course: string | null;
  email: string;
  email_explicit: boolean;
  phone: string | null;
  identity_number: string | null;
  membership_expiry: string;
  expiry_explicit: boolean;
  status: 'new' | 'exists' | 'error';
  errors: string[];
}

export interface ImportPreviewResult {
  total_rows: number;
  preview: ParsedPatronRow[];
  summary: {
    new: number;
    exists: number;
    error: number;
  };
}

export interface ImportErrorItem {
  row: number;
  student_code: string;
  code: string;
  message: string;
}

export interface ImportExecuteResult {
  total_rows: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportErrorItem[];
}

function normalizeHeader(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd');
}

function normalizeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * Maps low-level DB errors to business error codes.
 * Never leak raw constraint details to API consumers.
 */
function mapDbError(err: any, fallbackCode: string): { code: string; message: string } {
  const detail: string = err?.detail || err?.message || '';
  if (err?.code === '23505' || /duplicate key value/i.test(detail)) {
    if (/\(email\)/i.test(detail)) {
      return { code: 'duplicate_email', message: 'Email đã được sử dụng bởi người dùng khác' };
    }
    if (/\(identity_number\)/i.test(detail)) {
      return { code: 'duplicate_identity', message: 'CCCD/CMND đã được sử dụng' };
    }
    if (/\(card_number\)/i.test(detail)) {
      return { code: 'card_conflict', message: 'Mã thẻ đã tồn tại trong hệ thống' };
    }
    if (/\(student_code\)/i.test(detail)) {
      return { code: 'duplicate_student_code', message: 'Mã sinh viên đã tồn tại' };
    }
    return { code: 'duplicate_conflict', message: 'Dữ liệu đã tồn tại trong hệ thống' };
  }
  return { code: fallbackCode, message: err?.message || 'Thao tác thất bại' };
}

export class PatronImportService {
  constructor(
    private patronRepo: PatronRepository,
    private userRepo: Repository<User>,
  ) {}

  /**
   * Generates sample import Excel template
   */
  async generateTemplate(): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'IUH Library System';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Danh sách độc giả', {
      views: [{ showGridLines: true }],
    });

    const columns = [
      { header: 'Mã sinh viên*', key: 'student_code', width: 18 },
      { header: 'Họ và tên*', key: 'full_name', width: 26 },
      { header: 'Lớp', key: 'class_name', width: 16 },
      { header: 'Khóa học / Niên khóa', key: 'course', width: 22 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Số điện thoại', key: 'phone', width: 18 },
      { header: 'CCCD/CMND', key: 'identity_number', width: 18 },
      { header: 'Hạn thẻ (YYYY-MM-DD)', key: 'membership_expiry', width: 24 },
    ];

    ws.columns = columns;

    // Header styling
    const headerRow = ws.getRow(1);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '0B4378' },
      };
      cell.font = {
        name: 'Segoe UI',
        bold: true,
        color: { argb: 'FFFFFF' },
        size: 11,
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'CCCCCC' } },
        bottom: { style: 'medium', color: { argb: '083159' } },
        left: { style: 'thin', color: { argb: 'CCCCCC' } },
        right: { style: 'thin', color: { argb: 'CCCCCC' } },
      };
    });

    // Sample data rows
    const sampleRows = [
      [
        '20112201',
        'Nguyễn Văn An',
        'DHKTPM18A',
        '2022-2026',
        '20112201@student.iuh.edu.vn',
        '0912345678',
        '079201001234',
        '2026-09-01',
      ],
      [
        '20112202',
        'Trần Thị Bích',
        'DHQTKD19B',
        '2023-2027',
        '',
        '0987654321',
        '079201005678',
        '',
      ],
    ];

    for (const sample of sampleRows) {
      const addedRow = ws.addRow(sample);
      addedRow.height = 22;
      addedRow.eachCell((cell) => {
        cell.font = { name: 'Segoe UI', size: 10 };
        cell.alignment = { vertical: 'middle' };
      });
    }

    return workbook;
  }

  /**
   * Parse rows from Excel buffer and validate internal structure
   */
  private async parseWorkbook(buffer: Buffer): Promise<ParsedPatronRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      throw new BadRequestError('Định dạng file không hợp lệ. Vui lòng tải file Excel (.xlsx)');
    }

    const ws = workbook.worksheets[0];
    if (!ws || ws.rowCount < 2) {
      throw new BadRequestError('File Excel trống hoặc không có dữ liệu');
    }

    // Determine column mapping
    const headerRow = ws.getRow(1);
    const colMap: Record<string, number> = {};
    headerRow.eachCell((cell, colNumber) => {
      const normalized = normalizeHeader(cell.value);
      if (normalized.includes('ma sinh vien') || normalized.includes('mssv') || normalized.includes('student_code')) {
        colMap.student_code = colNumber;
      } else if (normalized.includes('ho va ten') || normalized.includes('ho ten') || normalized.includes('full_name')) {
        colMap.full_name = colNumber;
      } else if (normalized.includes('lop') || normalized.includes('class')) {
        colMap.class_name = colNumber;
      } else if (normalized.includes('khoa hoc') || normalized.includes('nien khoa') || normalized.includes('course')) {
        colMap.course = colNumber;
      } else if (normalized.includes('email')) {
        colMap.email = colNumber;
      } else if (normalized.includes('so dien thoai') || normalized.includes('sdt') || normalized.includes('phone')) {
        colMap.phone = colNumber;
      } else if (normalized.includes('cccd') || normalized.includes('cmnd') || normalized.includes('identity')) {
        colMap.identity_number = colNumber;
      } else if (normalized.includes('han the') || normalized.includes('expiry')) {
        colMap.membership_expiry = colNumber;
      }
    });

    if (!colMap.student_code || !colMap.full_name) {
      throw new BadRequestError("File Excel thiếu cột bắt buộc 'Mã sinh viên' hoặc 'Họ và tên'");
    }

    const rows: ParsedPatronRow[] = [];
    const studentCodeCounts = new Map<string, number>();
    const emailCounts = new Map<string, number>();
    const identityCounts = new Map<string, number>();

    const getCellValue = (row: ExcelJS.Row, colIdx?: number): string => {
      if (!colIdx) return '';
      const cell = row.getCell(colIdx);
      if (cell.value instanceof Date) {
        return cell.value.toISOString().split('T')[0];
      }
      return normalizeString(cell.text || cell.value);
    };

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const studentCodeRaw = getCellValue(row, colMap.student_code);
      const fullNameRaw = getCellValue(row, colMap.full_name);

      // Skip entirely blank rows
      if (!studentCodeRaw && !fullNameRaw) continue;

      const studentCode = studentCodeRaw.trim().toUpperCase();
      const fullName = fullNameRaw.trim();
      const className = getCellValue(row, colMap.class_name) || null;
      const course = getCellValue(row, colMap.course) || null;
      const emailCell = getCellValue(row, colMap.email).toLowerCase();
      const email_explicit = emailCell.length > 0;
      let email = emailCell;
      let phone = getCellValue(row, colMap.phone) || null;
      let identityNumber = getCellValue(row, colMap.identity_number) || null;
      let expiryCell = getCellValue(row, colMap.membership_expiry);

      const errors: string[] = [];

      // Validation 1: Required fields
      if (!studentCode) errors.push('missing_field');
      if (!fullName) errors.push('missing_field');

      // Default email if missing
      if (!email && studentCode) {
        email = `${studentCode.toLowerCase()}@library.local`;
      } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('invalid_email');
      }

      // Phone validation (if provided)
      if (phone) {
        phone = phone.replace(/[\s.-]/g, '');
        // Excel drops the leading zero when a phone is typed as a number
        // (0912345678 -> 912345678): restore it for valid VN mobile prefixes
        if (/^[35789]\d{8}$/.test(phone)) {
          phone = `0${phone}`;
        }
        phone = phone.replace(/^\+84/, '0');
        if (!/^0\d{9}$/.test(phone)) {
          errors.push('invalid_phone');
        }
      }

      // Expiry parsing (explicit only when the cell holds YYYY-MM-DD)
      const expiry_explicit = /^\d{4}-\d{2}-\d{2}$/.test(expiryCell);
      let membershipExpiry = this.parseExpiry(expiryCell, course);

      // Track duplicate keys inside file
      if (studentCode) {
        studentCodeCounts.set(studentCode, (studentCodeCounts.get(studentCode) || 0) + 1);
      }
      if (email) {
        emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
      }
      if (identityNumber) {
        identityCounts.set(identityNumber, (identityCounts.get(identityNumber) || 0) + 1);
      }

      rows.push({
        row: r,
        student_code: studentCode,
        full_name: fullName,
        class_name: className,
        course,
        email,
        email_explicit,
        phone,
        identity_number: identityNumber,
        membership_expiry: membershipExpiry,
        expiry_explicit,
        status: errors.length > 0 ? 'error' : 'new',
        errors,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestError('File Excel trống hoặc không có dữ liệu');
    }

    if (rows.length > 2000) {
      throw new BadRequestError('File vượt quá giới hạn 2000 dòng. Vui lòng chia nhỏ file.');
    }

    // Flag internal duplicates in file
    for (const r of rows) {
      if (r.student_code && (studentCodeCounts.get(r.student_code) || 0) > 1) {
        if (!r.errors.includes('duplicate_in_file')) r.errors.push('duplicate_in_file');
        r.status = 'error';
      }
      if (r.email && (emailCounts.get(r.email) || 0) > 1) {
        if (!r.errors.includes('duplicate_in_file')) r.errors.push('duplicate_in_file');
        r.status = 'error';
      }
      if (r.identity_number && (identityCounts.get(r.identity_number) || 0) > 1) {
        if (!r.errors.includes('duplicate_in_file')) r.errors.push('duplicate_in_file');
        r.status = 'error';
      }
    }

    return rows;
  }

  /**
   * Parse expiry date: cell value > course range (YYYY-09-01) > +4 years (YYYY-09-01)
   */
  private parseExpiry(cellVal: string, course: string | null): string {
    if (cellVal && /^\d{4}-\d{2}-\d{2}$/.test(cellVal)) {
      return cellVal;
    }
    if (course) {
      const rangeMatch = course.match(/(\d{4})\s*[-–]\s*(\d{4})/);
      if (rangeMatch) {
        return `${rangeMatch[2]}-09-01`;
      }
      const singleMatch = course.match(/(\d{4})/);
      if (singleMatch) {
        return `${singleMatch[1]}-09-01`;
      }
    }
    const defaultYear = new Date().getFullYear() + 4;
    return `${defaultYear}-09-01`;
  }

  /**
   * Preview up to 100 rows with batch DB conflict resolution
   */
  async preview(buffer: Buffer): Promise<ImportPreviewResult> {
    const rows = await this.parseWorkbook(buffer);
    const previewRows = rows.slice(0, 100);

    const studentCodes = previewRows.map((r) => r.student_code).filter(Boolean);
    const emails = previewRows.map((r) => r.email).filter(Boolean);
    const identities = previewRows.map((r) => r.identity_number).filter(Boolean) as string[];
    const cards = previewRows.map((r) => `THV-${r.student_code}`).filter(Boolean);

    // Batch DB query using In() to prevent N+1 query loop
    const conditions: any[] = [];
    if (studentCodes.length) conditions.push({ studentCode: In(studentCodes) });
    if (emails.length) conditions.push({ email: In(emails) });
    if (identities.length) conditions.push({ identityNumber: In(identities) });
    if (cards.length) conditions.push({ cardNumber: In(cards) });

    const existingUsers = conditions.length > 0 ? await this.userRepo.find({ where: conditions }) : [];

    const existingByCode = new Map<string, User>();
    const existingByEmail = new Map<string, User>();
    const existingByIdentity = new Map<string, User>();
    const existingByCard = new Map<string, User>();

    for (const u of existingUsers) {
      if (u.studentCode) existingByCode.set(u.studentCode, u);
      if (u.email) existingByEmail.set(u.email.toLowerCase(), u);
      if (u.identityNumber) existingByIdentity.set(u.identityNumber, u);
      if (u.cardNumber) existingByCard.set(u.cardNumber, u);
    }

    for (const r of previewRows) {
      if (r.errors.length > 0) {
        r.status = 'error';
        continue;
      }

      // Check student code existence
      if (existingByCode.has(r.student_code)) {
        r.status = 'exists';
        continue;
      }

      // Check conflicting email with other users
      const emailUser = existingByEmail.get(r.email);
      if (emailUser && emailUser.studentCode !== r.student_code) {
        r.status = 'error';
        r.errors.push('duplicate_email');
        continue;
      }

      // Check conflicting identity number
      if (r.identity_number) {
        const idUser = existingByIdentity.get(r.identity_number);
        if (idUser && idUser.studentCode !== r.student_code) {
          r.status = 'error';
          r.errors.push('duplicate_identity');
          continue;
        }
      }

      // Check conflicting card number
      const cardUser = existingByCard.get(`THV-${r.student_code}`);
      if (cardUser && cardUser.studentCode !== r.student_code) {
        r.status = 'error';
        r.errors.push('card_conflict');
        continue;
      }

      r.status = 'new';
    }

    let countNew = 0;
    let countExists = 0;
    let countError = 0;

    for (const r of previewRows) {
      if (r.status === 'new') countNew++;
      else if (r.status === 'exists') countExists++;
      else countError++;
    }

    return {
      total_rows: rows.length,
      preview: previewRows,
      summary: {
        new: countNew,
        exists: countExists,
        error: countError,
      },
    };
  }

  /**
   * Execute batch patron import with per-row fault isolation
   */
  async execute(buffer: Buffer, mode: 'skip' | 'update' = 'skip'): Promise<ImportExecuteResult> {
    const rows = await this.parseWorkbook(buffer);

    const studentCodes = rows.map((r) => r.student_code).filter(Boolean);
    const emails = rows.map((r) => r.email).filter(Boolean);
    const identities = rows.map((r) => r.identity_number).filter(Boolean) as string[];
    const cards = rows.map((r) => `THV-${r.student_code}`).filter(Boolean);

    const conditions: any[] = [];
    if (studentCodes.length) conditions.push({ studentCode: In(studentCodes) });
    if (emails.length) conditions.push({ email: In(emails) });
    if (identities.length) conditions.push({ identityNumber: In(identities) });
    if (cards.length) conditions.push({ cardNumber: In(cards) });

    const existingUsers = conditions.length > 0 ? await this.userRepo.find({ where: conditions }) : [];

    const existingByCode = new Map<string, User>();
    const existingByEmail = new Map<string, User>();
    const existingByIdentity = new Map<string, User>();
    const existingByCard = new Map<string, User>();

    for (const u of existingUsers) {
      if (u.studentCode) existingByCode.set(u.studentCode, u);
      if (u.email) existingByEmail.set(u.email.toLowerCase(), u);
      if (u.identityNumber) existingByIdentity.set(u.identityNumber, u);
      if (u.cardNumber) existingByCard.set(u.cardNumber, u);
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors: ImportErrorItem[] = [];

    const defaultPasswordHash = await bcrypt.hash('11111111', 10);
    const today = new Date().toISOString().split('T')[0];

    for (const r of rows) {
      if (r.errors.length > 0) {
        errors.push({
          row: r.row,
          student_code: r.student_code,
          code: r.errors[0],
          message: `Lỗi dòng ${r.row}: ${r.errors.join(', ')}`,
        });
        continue;
      }

      const existingPatron = existingByCode.get(r.student_code);

      if (existingPatron) {
        if (mode === 'skip') {
          skipped++;
          continue;
        }

        // Mode update: only explicitly provided cells overwrite existing data.
        // Empty cells mean "keep current value" (never mass-blank real data).
        // fullName, cardNumber, passwordHash are never touched here.
        try {
          const patch: Record<string, string | null> = {};
          if (r.class_name !== null) patch.className = r.class_name;
          if (r.course !== null) patch.course = r.course;
          if (r.phone !== null) patch.phone = r.phone;
          if (r.email_explicit) patch.email = r.email;
          if (r.expiry_explicit) patch.membershipExpiry = r.membership_expiry;
          await this.patronRepo.update(existingPatron.id, patch);
          updated++;
        } catch (err: any) {
          const mapped = mapDbError(err, 'update_failed');
          errors.push({
            row: r.row,
            student_code: r.student_code,
            code: mapped.code,
            message: mapped.message,
          });
        }
        continue;
      }

      // Check DB conflict with other users
      const emailUser = existingByEmail.get(r.email);
      if (emailUser && emailUser.studentCode !== r.student_code) {
        errors.push({
          row: r.row,
          student_code: r.student_code,
          code: 'duplicate_email',
          message: `Email ${r.email} đã được sử dụng bởi người dùng khác`,
        });
        continue;
      }

      if (r.identity_number) {
        const idUser = existingByIdentity.get(r.identity_number);
        if (idUser && idUser.studentCode !== r.student_code) {
          errors.push({
            row: r.row,
            student_code: r.student_code,
            code: 'duplicate_identity',
            message: `CCCD ${r.identity_number} đã được sử dụng`,
          });
          continue;
        }
      }

      const cardUser = existingByCard.get(`THV-${r.student_code}`);
      if (cardUser && cardUser.studentCode !== r.student_code) {
        errors.push({
          row: r.row,
          student_code: r.student_code,
          code: 'card_conflict',
          message: `Thẻ THV-${r.student_code} đã tồn tại trong hệ thống`,
        });
        continue;
      }

      // Create new patron
      try {
        const newPatron = await this.patronRepo.create({
          studentCode: r.student_code,
          fullName: r.full_name,
          email: r.email,
          passwordHash: defaultPasswordHash,
          role: UserRole.PATRON,
          className: r.class_name,
          course: r.course,
          phone: r.phone,
          identityNumber: r.identity_number,
          cardNumber: `THV-${r.student_code}`,
          issueDate: today,
          membershipExpiry: r.membership_expiry,
          status: 'active',
          currentStatus: 'outside',
          passwordAutoGenerated: true,
        });

        // Publish AMQP event if available
        try {
          const { amqpClient } = require('../clients/AmqpClient');
          if (amqpClient && typeof amqpClient.publish === 'function') {
            amqpClient.publish('user.registered', {
              userId: newPatron.id,
              email: newPatron.email,
              fullName: newPatron.fullName,
              studentCode: newPatron.studentCode,
              cardNumber: newPatron.cardNumber,
              status: newPatron.status,
            }).catch(() => {});
          }
        } catch {
          // AMQP publish failure is non-blocking
        }

        // Add to map in case subsequent rows conflict
        existingByCode.set(r.student_code, newPatron);
        existingByEmail.set(r.email.toLowerCase(), newPatron);
        if (r.identity_number) existingByIdentity.set(r.identity_number, newPatron);
        existingByCard.set(`THV-${r.student_code}`, newPatron);

        imported++;
      } catch (err: any) {
        const mapped = mapDbError(err, 'create_failed');
        errors.push({
          row: r.row,
          student_code: r.student_code,
          code: mapped.code,
          message: mapped.message,
        });
      }
    }

    return {
      total_rows: rows.length,
      imported,
      updated,
      skipped,
      errors,
    };
  }
}
