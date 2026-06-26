import { scheduleClient, notificationClient, userClient } from '../clients/serviceClients';

function localDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function shiftReminderNotify(config: Record<string, any>): Promise<any> {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDate(tomorrow);

  let assignments;
  try {
    assignments = await scheduleClient.getUpcomingAssignments(tomorrowStr, tomorrowStr);
  } catch {
    return { notified: 0, message: 'Failed to fetch upcoming schedule' };
  }

  const items = assignments?.items || [];
  if (items.length === 0) {
    return { notified: 0, message: 'No shifts tomorrow' };
  }

  const notifications = [];

  for (const item of items) {
    if (item.status === 'cancelled' || item.status === 'completed') continue;

    const staffName = item.staff?.fullName || 'Bạn';
    const shiftName = item.shift?.name || 'Ca trực';
    const startTime = item.shift?.startTime || '';
    const endTime = item.shift?.endTime || '';
    const zoneName = item.zone?.name || 'Khu vực';
    const workDate = item.workDate;

    const formattedDate = (() => {
      const d = new Date(`${workDate}T00:00:00`);
      return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
    })();

    notifications.push({
      userId: item.staffId,
      type: 'shift_reminder',
      title: `Nhắc nhở: Ca trực ngày mai`,
      body: `Xin chào ${staffName},\nBạn có ca trực vào ngày mai (${formattedDate}):\n- Ca: ${shiftName} (${startTime} - ${endTime})\n- Khu vực: ${zoneName}\nVui lòng có mặt đúng giờ.`,
      data: {
        scheduleId: item.id,
        shiftId: item.shiftId,
        zoneId: item.zoneId,
        workDate: item.workDate,
        shiftName,
        startTime,
        endTime,
        zoneName,
      },
    });
  }

  if (notifications.length === 0) {
    return { notified: 0, message: 'No valid shifts tomorrow' };
  }

  try {
    await notificationClient.createBulkNotifications(notifications);
    return { notified: notifications.length, message: `Sent ${notifications.length} reminders` };
  } catch (err) {
    console.error('[shiftReminderNotify] Failed to send notifications:', err);
    return { notified: 0, message: 'Failed to send notifications' };
  }
}