import { notificationClient, userClient } from '../clients/serviceClients';
import { AutomationEvent } from '../events/EventBus';

export async function scheduleChangeNotify(
  _cfg: Record<string, any>,
  event?: AutomationEvent
): Promise<any> {
  if (!event || event.type !== 'schedule.changed') {
    return { notified: 0, message: 'Not a schedule.changed event' };
  }

  const { staffId, oldShift, newShift, workDate, changeType } = event.payload;

  if (!staffId) {
    return { notified: 0, message: 'No staffId in event payload' };
  }

  let staffName = 'Nhân viên';
  try {
    const user = await userClient.getUser(staffId);
    if (user?.fullName) staffName = user.fullName;
  } catch {}

  let message = '';
  switch (changeType) {
    case 'swap':
      message = `Lịch trực ngày ${workDate} đã được đổi. Ca mới: ${newShift || 'Chưa xác định'}.`;
      break;
    case 'assigned':
      message = `Bạn đã được phân ca trực ngày ${workDate}: ${newShift}.`;
      break;
    case 'cancelled':
      message = `Ca trực ngày ${workDate} (${oldShift}) đã bị hủy.`;
      break;
    default:
      message = `Lịch trực ngày ${workDate} đã thay đổi.`;
  }

  await notificationClient.createNotification({
    userId: staffId,
    type: 'schedule_change',
    title: 'Thay đổi lịch trực',
    body: message,
    data: { staffId, oldShift, newShift, workDate, changeType },
  });

  return { notified: 1 };
}
