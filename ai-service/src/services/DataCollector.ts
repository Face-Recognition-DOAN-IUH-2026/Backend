import { config } from '../config';
import { LibraryOperationsSnapshot } from './types';

type FetchResult = { ok: true; data: any } | { ok: false; error: string };

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function getJson(baseUrl: string, path: string, token: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
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
    ] = await Promise.all([
      getJson(config.accessServiceUrl, '/access/stats', token),
      getJson(config.accessServiceUrl, '/access/active', token),
      getJson(config.accessServiceUrl, `/access/logs?dateFrom=${today}&limit=200`, token),
      getJson(config.borrowServiceUrl, '/borrow/staff/active-borrowers', token),
      getJson(config.borrowServiceUrl, '/borrow/books?skip=0&limit=100', token),
      getJson(config.scheduleServiceUrl, `/schedules/assignments?from=${today}&to=${today}`, token),
    ]);

    const warnings = [statsRes, activeRes, logsRes, activeBorrowersRes, booksRes, assignmentsRes]
      .filter((item): item is { ok: false; error: string } => !item.ok)
      .map((item) => item.error);

    const stats = statsRes.ok ? statsRes.data : {};
    const activePatrons = activeRes.ok ? list(activeRes.data) : [];
    const accessLogs = logsRes.ok ? list(logsRes.data) : [];
    const activeBorrowers = activeBorrowersRes.ok ? list(activeBorrowersRes.data) : [];
    const books = booksRes.ok ? list(booksRes.data) : [];
    const assignments = assignmentsRes.ok ? list(assignmentsRes.data) : [];

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
