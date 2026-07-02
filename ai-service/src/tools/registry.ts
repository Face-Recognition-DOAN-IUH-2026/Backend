import { ToolResult, searchBooks, getShelfLocation, lookupBook, getLibraryHours as getHoursFn, getMyPatronInfo, getMyBorrows, getMyHistory, getPatronInfoById, getPatronBorrowsById, getPatronHistoryById, getOverdueBorrows, getScheduleToday } from './tools';

export interface ToolDef {
  name: string;
  description: string;
  func: (...args: any[]) => Promise<ToolResult>;
  injectUserId?: boolean;
}

const getLibraryHours = async (): Promise<ToolResult> => getHoursFn();

const patronBase: ToolDef[] = [
  { name: 'search_books', description: 'Tim kiem sach trong thu vien theo ten, tac gia hoac tu khoa.', func: searchBooks },
  { name: 'get_shelf_location', description: 'Tim vi tri ke sach (tang, ke, mat) cua mot cuon sach.', func: getShelfLocation },
  { name: 'lookup_book', description: 'Tra cuu thong tin chi tiet mot cuon sach theo ISBN.', func: lookupBook },
  { name: 'get_library_hours', description: 'Xem gio mo cua thu vien trong tuan.', func: getLibraryHours },
];

export const patronToolDefs: ToolDef[] = [
  ...patronBase,
  { name: 'get_patron_info', description: 'Khong can tham so — hien thi thong tin tai khoan the thu vien cua ban.', func: (userId: string) => getMyPatronInfo(userId), injectUserId: true },
  { name: 'get_patron_borrows', description: 'Khong can tham so — hien thi cac sach ban dang muon.', func: (userId: string) => getMyBorrows(userId), injectUserId: true },
  { name: 'get_patron_history', description: 'Khong can tham so — hien thi lich su muon tra cua ban.', func: (userId: string) => getMyHistory(userId), injectUserId: true },
];

export const staffToolDefs: ToolDef[] = [
  ...patronBase,
  { name: 'get_patron_info', description: 'Tra cuu thong tin doc gia theo ma sinh vien. Input: student_code', func: getPatronInfoById },
  { name: 'get_patron_borrows', description: 'Tra cuu sach dang muon cua mot doc gia theo ma sinh vien. Input: student_code', func: getPatronBorrowsById },
  { name: 'get_patron_history', description: 'Tra cuu lich su muon tra cua mot doc gia theo ma sinh vien. Input: student_code', func: getPatronHistoryById },
  { name: 'get_overdue_borrows', description: 'Xem danh sach sach tre han trong toan he thong. Khong can tham so.', func: getOverdueBorrows },
  { name: 'get_schedule_today', description: 'Xem lich truc cua nhan vien hom nay. Khong can tham so.', func: getScheduleToday },
];

export const adminToolDefs: ToolDef[] = [...staffToolDefs];

export function getToolDefsForRole(role: string): ToolDef[] {
  switch (role) {
    case 'patron': return patronToolDefs;
    case 'staff':
    case 'admin': return adminToolDefs;
    default: return patronToolDefs;
  }
}