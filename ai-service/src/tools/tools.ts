import axios from 'axios';
import { config } from '../config';
import { getServiceToken } from '../../../shared';

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


export async function searchBooks(query: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/books/search?query=${encodeURIComponent(query)}`;
  return safeGet<any>(url);
}

export async function getShelfLocation(bookId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/shelves?book_id=${encodeURIComponent(bookId)}`;
  return safeGet<any>(url);
}

export async function getPatronInfo(patronId: string): Promise<ToolResult> {
  const url = `${config.userServiceUrl}/internal/patrons/${encodeURIComponent(patronId)}`;
  return safeGet<any>(url);
}

export async function getPatronBorrows(patronId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patron/${encodeURIComponent(patronId)}`;
  return safeGet<any>(url);
}

export async function getPatronHistory(patronId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patrons/id/${encodeURIComponent(patronId)}/history`;
  return safeGet<any>(url);
}

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

export function getLibraryHours(): ToolResult {
  return {
    success: true,
    data: {
      schedule: [
        { days: 'Monday - Friday', hours: '06:30 - 21:00' },
        { days: 'Saturday - Sunday', hours: '08:00 - 19:30' },
      ],
      note: 'Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt',
    },
  };
}


export async function lookupBook(
  isbnOrQuery: string
): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/books/lookup?isbn=${encodeURIComponent(isbnOrQuery)}`;
  return safeGet<any>(url);
}


export const tools = [
  {
    name: 'search_books',
    description: 'Search for books in the library catalog. Use this when user wants to find books by title, author, or keywords. Input: search query string.',
    func: searchBooks,
  },
  {
    name: 'get_shelf_location',
    description: 'Get the physical location (shelf, floor, tier, face) of a specific book. Use this when user asks where a book is located. Input: book ID.',
    func: getShelfLocation,
  },
  {
    name: 'get_patron_info',
    description: 'Get detailed information about a library patron/member including their card status, registration date, and contact details. Input: patron ID.',
    func: getPatronInfo,
  },
  {
    name: 'get_patron_borrows',
    description: 'Get all currently borrowed books for a specific patron. Use this to check what books a patron has checked out. Input: patron ID.',
    func: getPatronBorrows,
  },
  {
    name: 'get_patron_history',
    description: 'Get the full borrow history (including returned books) for a specific patron. Use this when user asks about their borrow history, past books, or reading history. Input: patron ID.',
    func: getPatronHistory,
  },
  {
    name: 'get_overdue_borrows',
    description: 'Get a list of all overdue book borrows in the system. Use this to check for overdue items or generate overdue reports. No input required.',
    func: getOverdueBorrows,
  },
  {
    name: 'get_schedule_today',
    description: 'Get the staff work schedule for today. Returns list of staff members with their assigned shifts and locations. No input required.',
    func: getScheduleToday,
  },
  {
    name: 'get_library_hours',
    description: 'Get the library opening hours for all days of the week. Returns regular hours and any notes about special hours. No input required.',
    func: getLibraryHours,
  },
  {
    name: 'lookup_book',
    description: 'Look up a book by ISBN or title. First checks the local database, then falls back to Google Books API. Returns book details including title, author, description, cover image, categories. Use this when user wants to check if a book exists or get its metadata. Input: ISBN number or book title string.',
    func: lookupBook,
  },
];

export default tools;