"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dailyStatsReport = dailyStatsReport;
const serviceClients_1 = require("../clients/serviceClients");
async function dailyStatsReport(config) {
    const today = new Date().toISOString().split('T')[0];
    // Collect data in parallel
    const [accessStats, activePatrons, activeBorrowers, scheduleAssignments, books] = await Promise.allSettled([
        serviceClients_1.accessClient.getStats(),
        serviceClients_1.accessClient.getActivePatrons(),
        serviceClients_1.borrowClient.getActiveBorrowers(),
        serviceClients_1.scheduleClient.getTodayAssignments(),
        serviceClients_1.borrowClient.getBooks(0, 10),
    ]);
    const stats = {
        date: today,
        access: {
            activeInside: accessStats.status === 'fulfilled' ? accessStats.value?.active_inside || 0 : 0,
            todayEntries: accessStats.status === 'fulfilled' ? accessStats.value?.today_entries || 0 : 0,
            todayExits: accessStats.status === 'fulfilled' ? accessStats.value?.today_exits || 0 : 0,
        },
        borrows: {
            activeBorrowers: activeBorrowers.status === 'fulfilled' ? activeBorrowers.value?.total || 0 : 0,
        },
        schedule: {
            staffOnDuty: scheduleAssignments.status === 'fulfilled'
                ? Array.isArray(scheduleAssignments.value) ? scheduleAssignments.value.length : scheduleAssignments.value?.total || 0
                : 0,
        },
        books: {
            total: books.status === 'fulfilled' ? books.value?.total || 0 : 0,
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
    let adminUserIds = config.admin_user_ids || [];
    if (adminUserIds.length === 0) {
        try {
            const admins = await serviceClients_1.userClient.getUsersByRole('admin');
            adminUserIds = Array.isArray(admins) ? admins.map((u) => u.id) : [];
        }
        catch {
            // fallback: try staff as well
            try {
                const staff = await serviceClients_1.userClient.getUsersByRole('staff');
                adminUserIds = Array.isArray(staff) ? staff.map((u) => u.id) : [];
            }
            catch { }
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
        await serviceClients_1.notificationClient.createBulkNotifications(notifications);
    }
    return { stats, notified: adminUserIds.length };
}
