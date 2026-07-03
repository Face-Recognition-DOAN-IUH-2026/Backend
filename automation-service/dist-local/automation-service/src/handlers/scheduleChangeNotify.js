"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleChangeNotify = scheduleChangeNotify;
const serviceClients_1 = require("../clients/serviceClients");
async function scheduleChangeNotify(_cfg, event) {
    if (!event || event.type !== 'schedule.changed') {
        return { notified: 0, message: 'Not a schedule.changed event' };
    }
    const { staffId, oldShift, newShift, shiftName, workDate, changeType } = event.payload;
    if (!staffId) {
        return { notified: 0, message: 'No staffId in event payload' };
    }
    let staffName = 'Nhân viên';
    try {
        const user = await serviceClients_1.userClient.getUser(staffId);
        if (user?.fullName)
            staffName = user.fullName;
    }
    catch { }
    const shiftDisplayName = shiftName || newShift || 'Chưa xác định';
    let message = '';
    switch (changeType) {
        case 'swap':
            message = `Lịch trực ngày ${workDate} đã được đổi. Ca mới: ${shiftDisplayName}.`;
            break;
        case 'assigned':
            message = `Bạn đã được phân ca trực ngày ${workDate}: ${shiftDisplayName}.`;
            break;
        case 'cancelled':
            message = `Ca trực ngày ${workDate} (${shiftDisplayName}) đã bị hủy.`;
            break;
        default:
            message = `Lịch trực ngày ${workDate} đã thay đổi.`;
    }
    await serviceClients_1.notificationClient.createNotification({
        userId: staffId,
        type: 'schedule_change',
        title: 'Thay đổi lịch trực',
        body: message,
        data: { staffId, oldShift, newShift, workDate, changeType },
    });
    return { notified: 1 };
}
