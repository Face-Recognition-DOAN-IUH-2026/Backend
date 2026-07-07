import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';
import { LibraryOperationsSnapshot } from './types';

type FetchResult = { ok: true; data: any } | { ok: false; error: string };

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function internalHeaders() {
  return {
    Authorization: `Bearer ${getServiceToken('ai-service', config.serviceJwtSecret)}`,
    Accept: 'application/json',
  };
}

async function getJson(baseUrl: string, path: string, token?: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `${path} returned ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (error: any) {
    return { ok: false, error: `${path} unavailable: ${error?.message || 'request failed'}` };
  } finally {
    clearTimeout(timer);
  }
}

function list(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.daily)) return data.daily;
  return [];
}

function countActiveBorrowers(rows: any[]) {
  return rows.reduce((sum, item) => (
    sum + Number(item.total_active_borrows ?? item.totalActiveBorrows ?? item.active_count ?? item.borrow_count ?? item.total_books ?? 0)
  ), 0);
}

function countOverdueBorrowers(rows: any[]) {
  return rows.reduce((sum, item) => (
    sum + Number(item.overdue_count ?? item.overdueCount ?? item.total_overdue ?? item.overdue_borrows ?? 0)
  ), 0);
}

export class DataCollector {
  async collect(token: string): Promise<LibraryOperationsSnapshot> {
    const today = todayStr();
    const [
      statsRes,
      activeRes,
      logsRes,
      activeBorrowersRes,
      booksRes,
      assignmentsRes,
    ] = await Promise.allSettled([
      getJson(config.accessServiceUrl, '/access/stats', token),
      getJson(config.accessServiceUrl, '/access/active', token),
      getJson(config.accessServiceUrl, `/access/logs?dateFrom=${today}&limit=200`, token),
      getJson(config.borrowServiceUrl, '/borrow/staff/active-borrowers', token),
      getJson(config.borrowServiceUrl, '/borrow/books?skip=0&limit=100', token),
      getJson(config.scheduleServiceUrl, `/schedules/internal/upcoming?from=${today}&to=${today}`),
    ]);

    const settled = (r: PromiseSettledResult<FetchResult>): FetchResult =>
      r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message || 'Promise rejected' };

    const statsResVal = settled(statsRes);
    const activeResVal = settled(activeRes);
    const logsResVal = settled(logsRes);
    const activeBorrowersResVal = settled(activeBorrowersRes);
    const booksResVal = settled(booksRes);
    const assignmentsResVal = settled(assignmentsRes);

    const warnings = [statsResVal, activeResVal, logsResVal, activeBorrowersResVal, booksResVal, assignmentsResVal]
      .filter((item): item is { ok: false; error: string } => !item.ok)
      .map((item) => item.error);

    const stats = statsResVal.ok ? statsResVal.data : {};
    const activePatrons = activeResVal.ok ? list(activeResVal.data) : [];
    const accessLogs = logsResVal.ok ? list(logsResVal.data) : [];
    const activeBorrowers = activeBorrowersResVal.ok ? list(activeBorrowersResVal.data) : [];
    const books = booksResVal.ok ? list(booksResVal.data) : [];
    const assignments = assignmentsResVal.ok ? list(assignmentsResVal.data) : [];

    const activeBorrows = countActiveBorrowers(activeBorrowers);
    const overdueBorrows = countOverdueBorrowers(activeBorrowers);

    return {
      active_patrons: Number(stats.active_inside ?? stats.activeInside ?? stats.active_patrons ?? activePatrons.length ?? 0),
      today_entries: Number(stats.today_entries ?? stats.todayEntries ?? 0),
      today_exits: Number(stats.today_exits ?? stats.todayExits ?? 0),
      active_borrows: activeBorrows,
      overdue_borrows: overdueBorrows,
      scheduled_staff_today: assignments.length,
      access_logs_sample: accessLogs.slice(0, 30),
      active_borrowers_sample: activeBorrowers.slice(0, 20),
      schedule_assignments_sample: assignments.slice(0, 30),
      inventory_sample: books.slice(0, 20),
      warnings,
    };
  }
}
