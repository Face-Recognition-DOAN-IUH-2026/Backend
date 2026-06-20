import axios from 'axios';
import config from '../config';

const INTERNAL_HEADERS = {
  'X-Internal-Api-Key': config.internalApiKey,
  'Content-Type': 'application/json',
};

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

async function safeGet<T>(url: string): Promise<ToolResult> {
  try {
    const response = await axios.get<T>(url, {
      headers: INTERNAL_HEADERS,
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

async function safePost<T>(url: string, body: any): Promise<ToolResult> {
  try {
    const response = await axios.post<T>(url, body, {
      headers: INTERNAL_HEADERS,
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

async function safePut<T>(url: string, body: any): Promise<ToolResult> {
  try {
    const response = await axios.put<T>(url, body, {
      headers: INTERNAL_HEADERS,
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
  const url = `${config.userServiceUrl}/patrons/${encodeURIComponent(patronId)}`;
  return safeGet<any>(url);
}

export async function getPatronBorrows(patronId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/patron/${encodeURIComponent(patronId)}`;
  return safeGet<any>(url);
}

export async function getOverdueBorrows(): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/overdue`;
  return safeGet<any>(url);
}

export async function getScheduleToday(): Promise<ToolResult> {
  const url = `${config.scheduleServiceUrl}/schedules/today`;
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

export async function returnBook(barcode: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/return`;
  return safePost<any>(url, { barcode });
}

export async function renewBorrow(recordId: string): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/renew`;
  return safePost<any>(url, { recordId });
}

export async function batchReturn(barcodes: string[]): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/batch-return`;
  return safePost<any>(url, { barcodes });
}

export async function addBook(
  isbn: string,
  title: string,
  author?: string,
  quantity?: number,
  shelf_location?: string,
  categories?: string,
  description?: string,
  cover_url?: string
): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/books`;
  return safePost<any>(url, {
    isbn,
    title,
    author,
    quantity: quantity || 1,
    shelf_location,
    categories,
    description,
    cover_url,
  });
}

export async function updateBookQuantity(
  bookId: string,
  quantity: number
): Promise<ToolResult> {
  const url = `${config.borrowServiceUrl}/borrow/internal/books/${bookId}/quantity`;
  return safePut<any>(url, { quantity });
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
    name: 'return_book',
    description: 'Return a book to the library by scanning its barcode. Use this when a patron wants to return a book. Input: book barcode string.',
    func: returnBook,
  },
  {
    name: 'renew_borrow',
    description: 'Extend the due date for a borrowed book by 14 more days. Use this when a patron wants to renew their borrowed book. Input: borrow record ID.',
    func: renewBorrow,
  },
  {
    name: 'batch_return',
    description: 'Return multiple books at once by scanning their barcodes. Use this when a patron wants to return multiple books. Input: array of barcode strings.',
    func: batchReturn,
  },
  {
    name: 'add_book',
    description: 'Add a new book to the library catalog with optional copies. Use this when staff wants to add a new book to the system. Inputs: isbn (required), title (required), author (optional), quantity (optional, default 1), shelf_location (optional), categories (optional), description (optional), cover_url (optional).',
    func: addBook,
  },
  {
    name: 'update_book_quantity',
    description: 'Update the quantity of copies for an existing book. Creates or removes copies as needed. Inputs: bookId (required), quantity (required, must be >= 1).',
    func: updateBookQuantity,
  },
];

export default tools;