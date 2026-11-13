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

export async function getLibraryHours(): Promise<ToolResult> {
  const url = `${config.scheduleServiceUrl}/schedules/internal/library-hours`;
  const result = await safeGet<any>(url);

  if (result.success && result.data && Array.isArray(result.data.schedule)) {
    return result;
  }

  // Fallback to internal shifts if library-hours endpoint is not available
  const shiftsUrl = `${config.scheduleServiceUrl}/schedules/internal/shifts`;
  const shiftsResult = await safeGet<any[]>(shiftsUrl);

  if (shiftsResult.success && Array.isArray(shiftsResult.data) && shiftsResult.data.length > 0) {
    const activeShifts = shiftsResult.data.filter((s: any) => s.isActive !== false);
    const starts = activeShifts.map((s: any) => (s.startTime || '').slice(0, 5)).filter(Boolean).sort();
    const ends = activeShifts.map((s: any) => (s.endTime || '').slice(0, 5)).filter(Boolean).sort();

    const start = starts[0] || '06:30';
    const end = ends[ends.length - 1] || '21:00';

    return {
      success: true,
      data: {
        schedule: [
          { days: 'Thứ Hai - Thứ Sáu (Monday - Friday)', hours: `${start} - ${end}` },
          { days: 'Thứ Bảy - Chủ Nhật (Saturday - Sunday)', hours: '08:00 - 19:30' },
        ],
        shifts: activeShifts.map((s: any) => ({
          name: s.name,
          hours: `${(s.startTime || '').slice(0, 5)} - ${(s.endTime || '').slice(0, 5)}`,
        })),
        note: 'Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt',
        formatted_text: `Thứ Hai - Thứ Sáu: ${start} - ${end}\nThứ Bảy - Chủ Nhật: 08:00 - 19:30\n(Lưu ý: Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt)`,
      },
    };
  }

  // Graceful fallback with standard hours if schedule-service is offline/unreachable
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

export async function getScheduleToday(staffId?: string): Promise<ToolResult> {
  const url = staffId
    ? `${config.scheduleServiceUrl}/schedules/internal/today?staffId=${encodeURIComponent(staffId)}`
    : `${config.scheduleServiceUrl}/schedules/internal/today`;
  const result = await safeGet<any>(url);

  if (result.success && result.data) {
    const list = Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.data.items)
      ? result.data.items
      : null;

    if (list) {
      list.sort((a: any, b: any) => {
        const timeA = a.shift?.startTime || '';
        const timeB = b.shift?.startTime || '';
        return timeA.localeCompare(timeB);
      });
    }
  }

  return result;
}

export async function recommendBooks(userId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patrons/id/${encodeURIComponent(userId)}/history`;
  const historyRes = await safeGet<any[]>(url);
  const history = historyRes.success && Array.isArray(historyRes.data) ? historyRes.data : [];

  const categories = new Set<string>();
  for (const item of history) {
    if (item.book?.category) categories.add(item.book.category);
    else if (item.category) categories.add(item.category);
    if (item.book?.author) categories.add(item.book.author);
  }
  const sampleKeyword = Array.from(categories)[0] || 'giáo trình';
  const booksUrl = `${config.borrowServiceUrl}/borrow/internal/books/search?query=${encodeURIComponent(sampleKeyword)}`;
  const booksRes = await safeGet<any>(booksUrl);

  return {
    success: true,
    data: {
      borrow_count: history.length,
      favorite_topics: Array.from(categories).slice(0, 5),
      recommended_books: booksRes.data?.items || booksRes.data || [],
    },
  };
}

export async function getOperationsSummary(): Promise<ToolResult> {
  try {
    const accessStatsUrl = `${config.accessServiceUrl}/access/stats`;
    const overdueUrl = `${config.borrowServiceUrl}/borrow/internal/overdue`;
    const [statsRes, overdueRes] = await Promise.all([
      safeGet<any>(accessStatsUrl),
      safeGet<any>(overdueUrl),
    ]);
    const overdueCount = overdueRes.success && Array.isArray(overdueRes.data) ? overdueRes.data.length : 0;
    return {
      success: true,
      data: {
        patrons_inside: statsRes.data?.active_inside ?? 0,
        today_entries: statsRes.data?.today_entries ?? 0,
        today_exits: statsRes.data?.today_exits ?? 0,
        total_overdue_borrows: overdueCount,
        report_time: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to get operations summary' };
  }
}
