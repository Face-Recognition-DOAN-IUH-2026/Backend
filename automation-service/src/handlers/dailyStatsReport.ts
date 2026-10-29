import { accessClient, borrowClient, scheduleClient, notificationClient, userClient } from '../clients/serviceClients';
import { toUtcDateStr } from '../../../shared/utils/date';

export async function dailyStatsReport(config: Record<string, any>): Promise<any> {
  const today = toUtcDateStr();

  // Collect data in parallel
  const [accessStats, activePatrons, activeBorrowers, scheduleAssignments, books] = await Promise.allSettled([
    accessClient.getStats(),
    accessClient.getActivePatrons(),
    borrowClient.getActiveBorrowers(),
    scheduleClient.getTodayAssignments(),
    borrowClient.getBooks(0, 10),
  ]);

  const stats = {
    date: today,
    access: {
      activeInside: accessStats.status === 'fulfilled' ? (accessStats.value as any)?.active_inside || 0 : 0,
      todayEntries: accessStats.status === 'fulfilled' ? (accessStats.value as any)?.today_entries || 0 : 0,
      todayExits: accessStats.status === 'fulfilled' ? (accessStats.value as any)?.today_exits || 0 : 0,
    },
    borrows: {
      activeBorrowers: activeBorrowers.status === 'fulfilled' ? (activeBorrowers.value as any)?.total || 0 : 0,
    },
    schedule: {
      staffOnDuty: scheduleAssignments.status === 'fulfilled'
        ? Array.isArray(scheduleAssignments.value) ? scheduleAssignments.value.length : (scheduleAssignments.value as any)?.total || 0
        : 0,
    },
    books: {
      total: books.status === 'fulfilled' ? (books.value as any)?.total || 0 : 0,
    },
  };

  // Build report message
  const lines = [
    `Báo cáo thống kê thư viện ngày ${today}`,
    ``,
    `Lưu lượng truy cập:`,
    `  - Đang trong thư viện: ${stats.access.activeInside}`,
    `  - Lượt vào hôm nay: ${stats.access.todayEntries}`,
    `  - Lượt ra hôm nay: ${stats.access.todayExits}`,
    ``,
    `Mượn trả:`,
    `  - Đang mượn sách: ${stats.borrows.activeBorrowers}`,
    ``,
    `Nhân viên:`,
    `  - Đang trực: ${stats.schedule.staffOnDuty}`,
    ``,
    `Thư viện:`,
    `  - Tổng đầu sách: ${stats.books.total}`,
  ];

  const reportBody = lines.join('\n');

  // Get admin user IDs dynamically from config or user-service
  let adminUserIds: string[] = config.admin_user_ids || [];

  if (adminUserIds.length === 0) {
    try {
      const admins = await userClient.getUsersByRole('admin');
      adminUserIds = Array.isArray(admins) ? admins.map((u: any) => u.id) : [];
    } catch (err) {
      console.warn('[dailyStatsReport] Failed to fetch admin users, trying staff:', (err as Error)?.message || err);
      try {
        const staff = await userClient.getUsersByRole('staff');
        adminUserIds = Array.isArray(staff) ? staff.map((u: any) => u.id) : [];
      } catch (err2) {
        console.warn('[dailyStatsReport] Failed to fetch staff users:', (err2 as Error)?.message || err2);
      }
    }
  }

  if (adminUserIds.length > 0) {
    const notifications = adminUserIds.map((userId) => ({
      userId,
      type: 'daily_report',
      title: `Báo cáo hàng ngày - ${today}`,
      body: reportBody,
      data: stats,
    }));
    await notificationClient.createBulkNotifications(notifications);
  }

  return { stats, notified: adminUserIds.length };
}
