"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tools = void 0;
exports.searchBooks = searchBooks;
exports.getShelfLocation = getShelfLocation;
exports.getPatronInfo = getPatronInfo;
exports.getPatronBorrows = getPatronBorrows;
exports.getPatronHistory = getPatronHistory;
exports.getOverdueBorrows = getOverdueBorrows;
exports.getScheduleToday = getScheduleToday;
exports.getLibraryHours = getLibraryHours;
exports.lookupBook = lookupBook;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const shared_1 = require("../../../shared");
function getInternalHeaders() {
    return {
        'Authorization': `Bearer ${(0, shared_1.getServiceToken)('ai-service', config_1.config.serviceJwtSecret)}`,
        'Content-Type': 'application/json',
    };
}
async function safeGet(url) {
    try {
        const response = await axios_1.default.get(url, {
            headers: getInternalHeaders(),
            timeout: 10000,
        });
        return { success: true, data: response.data };
    }
    catch (error) {
        const message = axios_1.default.isAxiosError(error)
            ? error.response?.data?.message || error.message
            : 'Unknown error';
        return { success: false, error: message };
    }
}
async function searchBooks(query) {
    const url = `${config_1.config.borrowServiceUrl}/borrow/internal/books/search?query=${encodeURIComponent(query)}`;
    return safeGet(url);
}
async function getShelfLocation(bookId) {
    const url = `${config_1.config.borrowServiceUrl}/borrow/internal/shelves?book_id=${encodeURIComponent(bookId)}`;
    return safeGet(url);
}
async function getPatronInfo(patronId) {
    const url = `${config_1.config.userServiceUrl}/internal/patrons/${encodeURIComponent(patronId)}`;
    return safeGet(url);
}
async function getPatronBorrows(patronId) {
    const url = `${config_1.config.borrowServiceUrl}/borrow/internal/patron/${encodeURIComponent(patronId)}`;
    return safeGet(url);
}
async function getPatronHistory(patronId) {
    const url = `${config_1.config.borrowServiceUrl}/borrow/internal/patrons/id/${encodeURIComponent(patronId)}/history`;
    return safeGet(url);
}
async function getOverdueBorrows() {
    const url = `${config_1.config.borrowServiceUrl}/borrow/internal/overdue`;
    return safeGet(url);
}
async function getScheduleToday() {
    const url = `${config_1.config.scheduleServiceUrl}/internal/today`;
    const result = await safeGet(url);
    if (result.success && result.data && Array.isArray(result.data)) {
        result.data.sort((a, b) => {
            const timeA = a.shift?.startTime || '';
            const timeB = b.shift?.startTime || '';
            return timeA.localeCompare(timeB);
        });
    }
    return result;
}
function getLibraryHours() {
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
async function lookupBook(isbnOrQuery) {
    const url = `${config_1.config.borrowServiceUrl}/borrow/internal/books/lookup?isbn=${encodeURIComponent(isbnOrQuery)}`;
    return safeGet(url);
}
exports.tools = [
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
exports.default = exports.tools;
