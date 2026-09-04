import axios from 'axios';
import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';

function getInternalHeaders() {
  return {
    'Authorization': `Bearer ${getServiceToken('ai-service', config.serviceJwtSecret)}`,
    'Content-Type': 'application/json',
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

async function safeGet<T>(url: string): Promise<ToolResult> {
  try {
    const response = await axios.get<T>(url, {
      headers: getInternalHeaders(),
      timeout: 10000,
    });
    return { success: true, data: response.data };
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.message || error.message
      : 'Unknown error';
    return { success: false, error: message };
  }
}

// ==================== Base tool functions (shared) ====================

export async function searchBooks(query: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/books/search?query=${encodeURIComponent(query)}`;
  return safeGet<any>(url);
}

export async function getShelfLocation(bookId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/shelves?book_id=${encodeURIComponent(bookId)}`;
  return safeGet<any>(url);
}

export async function lookupBook(isbnOrQuery: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/books/lookup?isbn=${encodeURIComponent(isbnOrQuery)}`;
  return safeGet<any>(url);
}

export function getLibraryHours(): ToolResult {
  return {
    success: true,
    data: {
      schedule: [
        { days: 'Thứ Hai - Thứ Sáu (Monday - Friday)', hours: '06:30 - 21:00' },
        { days: 'Thứ Bảy - Chủ Nhật (Saturday - Sunday)', hours: '08:00 - 19:30' },
      ],
      note: 'Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt',
      formatted_text: 'Thứ Hai - Thứ Sáu: 06:30 - 21:00\nThứ Bảy - Chủ Nhật: 08:00 - 19:30\n(Lưu ý: Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt)',
    },
  };
}

// ==================== Patron data — server-scoped (safe for patron tools) ====================

export async function getMyPatronInfo(userId: string): Promise<ToolResult> {
  const url = `${config.userServiceUrl}/internal/patrons/${encodeURIComponent(userId)}`;
  return safeGet<any>(url);
}

export async function getMyBorrows(userId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patron/${encodeURIComponent(userId)}`;
  return safeGet<any>(url);
}

export async function getMyHistory(userId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patrons/id/${encodeURIComponent(userId)}/history`;
  return safeGet<any>(url);
}

// ==================== Staff/Admin patron lookup (takes ID from AI, server validates) ====================

export async function getPatronInfoById(id: string): Promise<ToolResult> {
  const url = `${config.userServiceUrl}/internal/patrons/${encodeURIComponent(id)}`;
  return safeGet<any>(url);
}

export async function getPatronBorrowsById(id: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patron/${encodeURIComponent(id)}`;
  return safeGet<any>(url);
}

export async function getPatronHistoryById(id: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patrons/id/${encodeURIComponent(id)}/history`;
  return safeGet<any>(url);
}

// ==================== Staff/Admin admin tools ====================

export async function getOverdueBorrows(): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/overdue`;
  return safeGet<any>(url);
}

export async function getScheduleToday(): Promise<ToolResult> {
  const url = `${config.scheduleServiceUrl}/schedules/internal/today`;
  const result = await safeGet<any>(url);

  if (result.success && result.data && Array.isArray(result.data)) {
    result.data.sort((a: any, b: any) => {
      const timeA = a.shift?.startTime || '';
      const timeB = b.shift?.startTime || '';
      return timeA.localeCompare(timeB);
    });
  }

  return result;
}
