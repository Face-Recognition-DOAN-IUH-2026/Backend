"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkStaffAbsence = checkStaffAbsence;
const serviceClients_1 = require("../clients/serviceClients");
async function checkStaffAbsence(config) {
    let assignments;
    try {
        assignments = await serviceClients_1.scheduleClient.getTodayAssignments();
    }
    catch {
        return { checked: 0, alerted: 0, message: 'Failed to fetch schedule' };
    }
    const assignmentList = Array.isArray(assignments) ? assignments : assignments?.items || [];
    if (assignmentList.length === 0) {
        return { checked: 0, alerted: 0, message: 'No assignments today' };
    }
    const now = new Date();
    const absentStaff = [];
    for (const assignment of assignmentList) {
        const status = assignment.status;
        const staffId = assignment.staff_id || assignment.staffId;
        // If scheduled but not confirmed and shift has started
        if (status === 'scheduled' && assignment.shift_start) {
            const shiftStart = new Date(assignment.shift_start);
            const gracePeriod = 15 * 60 * 1000; // 15 minutes grace
            if (now.getTime() > shiftStart.getTime() + gracePeriod) {
                absentStaff.push({
                    staffId,
                    shiftName: assignment.shift_name || assignment.shiftName || 'Ca trực',
                    scheduledTime: assignment.shift_start,
                });
            }
        }
    }
    if (absentStaff.length === 0) {
        return { checked: assignmentList.length, alerted: 0, message: 'All staff present or within grace period' };
    }
    // Get admin user IDs dynamically
    let adminUserIds = config.admin_user_ids || [];
    if (adminUserIds.length === 0) {
        try {
            const admins = await serviceClients_1.userClient.getUsersByRole('admin');
            adminUserIds = Array.isArray(admins) ? admins.map((u) => u.id) : [];
        }
        catch { }
    }
    if (adminUserIds.length > 0) {
        const absentList = absentStaff
            .map((s) => `- ${s.staffId} (${s.shiftName} lúc ${s.scheduledTime})`)
            .join('\n');
        const notifications = adminUserIds.map((userId) => ({
            userId,
            type: 'anomaly_alert',
            title: `Cảnh báo: ${absentStaff.length} nhân viên vắng mặt`,
            body: `Nhân viên không check-in sau 15 phút:\n${absentList}`,
            data: { absentStaff, date: new Date().toISOString().split('T')[0] },
        }));
        await serviceClients_1.notificationClient.createBulkNotifications(notifications);
    }
    return { checked: assignmentList.length, alerted: absentStaff.length, absentStaff };
}
