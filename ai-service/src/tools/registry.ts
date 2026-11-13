import { ToolResult, searchBooks, getShelfLocation, lookupBook, getLibraryHours as getHoursFn, getMyPatronInfo, getMyBorrows, getMyHistory, getPatronInfoById, getPatronBorrowsById, getPatronHistoryById, getOverdueBorrows, getScheduleToday, recommendBooks, getOperationsSummary } from './tools';

export interface ToolParameterProperty {
  type: string;
  description?: string;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  func: (...args: any[]) => Promise<ToolResult>;
  injectUserId?: boolean;
  /** JSON Schema for the arguments the model may supply (OpenAI `tools[].function.parameters`). */
  parameters: ToolParameters;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
}

const getLibraryHours = async (): Promise<ToolResult> => getHoursFn();

/** No model-suppliable arguments at all (server decides everything). */
const NO_ARGS: ToolParameters = { type: 'object', properties: {}, required: [], additionalProperties: false };

const patronBase: ToolDef[] = [
  {
    name: 'search_books',
    description: 'Tim kiem sach trong thu vien theo ten, tac gia hoac tu khoa.',
    func: searchBooks,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Tu khoa tim kiem (ten sach, tac gia, chu de).' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_shelf_location',
    description: 'Tim vi tri ke sach (tang, ke, mat) cua mot cuon sach.',
    func: getShelfLocation,
    parameters: {
      type: 'object',
      properties: { book_id: { type: 'string', description: 'Ma hoac ISBN cua cuon sach.' } },
      required: ['book_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_book',
    description: 'Tra cuu thong tin chi tiet mot cuon sach theo ISBN.',
    func: lookupBook,
    parameters: {
      type: 'object',
      properties: { isbn_or_query: { type: 'string', description: 'ISBN hoac ten sach can tra cuu.' } },
      required: ['isbn_or_query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_library_hours',
    description: 'Xem gio mo cua thu vien trong tuan.',
    func: getLibraryHours,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

export const patronToolDefs: ToolDef[] = [
  ...patronBase,
  // injectUserId tools: the server injects the authenticated user id, so the model must
  // never be able to supply an argument (prevents IDOR via prompt injection).
  { name: 'get_patron_info', description: 'Khong can tham so — hien thi thong tin tai khoan the thu vien cua ban.', func: (userId: string) => getMyPatronInfo(userId), injectUserId: true, parameters: NO_ARGS },
  { name: 'get_patron_borrows', description: 'Khong can tham so — hien thi cac sach ban dang muon.', func: (userId: string) => getMyBorrows(userId), injectUserId: true, parameters: NO_ARGS },
  { name: 'get_patron_history', description: 'Khong can tham so — hien thi lich su muon tra cua ban.', func: (userId: string) => getMyHistory(userId), injectUserId: true, parameters: NO_ARGS },
  { name: 'recommend_books', description: 'Khong can tham so — goi y cac sach nen doc dua tren so thich va lich su muon cua ban.', func: (userId: string) => recommendBooks(userId), injectUserId: true, parameters: NO_ARGS },
];

export const staffToolDefs: ToolDef[] = [
  ...patronBase,
  {
    name: 'get_patron_info',
    description: 'Tra cứu thông tin độc giả theo mã sinh viên.',
    func: getPatronInfoById,
    parameters: {
      type: 'object',
      properties: { student_code: { type: 'string', description: 'Ma sinh vien, vi du 20520001.' } },
      required: ['student_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_patron_borrows',
    description: 'Tra cứu sách đang mượn của một độc giả theo ma sinh vien.',
    func: getPatronBorrowsById,
    parameters: {
      type: 'object',
      properties: { student_code: { type: 'string', description: 'Ma sinh vien, vi du 20520001.' } },
      required: ['student_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_patron_history',
    description: 'Tra cứu lịch sử mượn trả của một độc giả theo ma sinh vien.',
    func: getPatronHistoryById,
    parameters: {
      type: 'object',
      properties: { student_code: { type: 'string', description: 'Ma sinh vien, vi du 20520001.' } },
      required: ['student_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_overdue_borrows',
    description: 'Xem danh sach sach tre han trong toan he thong. Khong can tham so.',
    func: getOverdueBorrows,
    parameters: NO_ARGS,
  },
  {
    name: 'get_schedule_today',
    description: 'Xem lich truc cua chinh nhan vien (staff/admin) hom nay. Khong can tham so.',
    func: (userId: string) => getScheduleToday(userId),
    injectUserId: true,
    parameters: NO_ARGS,
  },
];

export const adminToolDefs: ToolDef[] = [
  ...staffToolDefs,
  {
    name: 'get_all_schedules',
    description: 'Xem toan bo lich truc cua tat ca nhan vien hom nay trong thu vien (chi danh cho admin). Khong can tham so.',
    func: () => getScheduleToday(),
    parameters: NO_ARGS,
  },
  {
    name: 'get_operations_summary',
    description: 'Xem thong ke van hanh tong quan toan thu vien hom nay (doc gia tai cho, luot ra vao, sach qua han). Khong can tham so.',
    func: getOperationsSummary,
    parameters: NO_ARGS,
  },
];

export function getToolDefsForRole(role: string): ToolDef[] {
  switch (role) {
    case 'patron': return patronToolDefs;
    case 'staff': return staffToolDefs;
    case 'admin': return adminToolDefs;
    default: return patronToolDefs;
  }
}

/** Convert role tools to the OpenAI `tools` request field for native function calling. */
export function toOpenAITools(tools: ToolDef[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      // Fail closed: a tool without a declared schema must not let the model supply arguments.
      parameters: tool.parameters ?? NO_ARGS,
    },
  }));
}

/**
 * Bind native function-call arguments to the positional parameters of `tool.func`,
 * following the DECLARED SCHEMA property order (never object key order, which depends
 * on how the provider serialised the arguments).
 */
export function bindToolArgs(tool: ToolDef, args: Record<string, unknown>): unknown[] {
  const supplied = args ?? {};
  const missing = (tool.parameters.required ?? []).filter(
    (key) => supplied[key] === undefined || supplied[key] === null,
  );
  if (missing.length > 0) {
    throw new Error(`Missing required argument(s): ${missing.join(', ')}`);
  }
  return Object.keys(tool.parameters.properties).map((key) => supplied[key]);
}
