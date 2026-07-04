import { notificationClient, userClient, emailClient } from '../clients/serviceClients';
import { AutomationEvent } from '../events/EventBus';

export async function fineNotification(_config: Record<string, any>, event?: AutomationEvent): Promise<any> {
  if (!event || event.type !== 'fine.incurred') {
    return { skipped: true, message: 'Not a fine.incurred event' };
  }

  const { patronId, bookTitle, fineAmount, daysOverdue, borrowRecordId } = event.payload;

  if (!patronId || !fineAmount) {
    return { skipped: true, message: 'Missing patronId or fineAmount' };
  }

  let patronName = 'Bạn';
  let patronEmail = '';
  try {
    const patron = await userClient.getUser(patronId);
    if (patron?.fullName) patronName = patron.fullName;
    if (patron?.email) patronEmail = patron.email;
  } catch (err) {
    console.warn('[fineNotification] Failed to fetch patron:', (err as Error)?.message || err);
  }

  await notificationClient.createNotification({
    userId: patronId,
    type: 'fine_notice',
    title: 'Nhắc phí quá hạn',
    body: `${patronName}, khoản phí quá hạn cho "${bookTitle || 'sách'}" là ${fineAmount.toLocaleString('vi-VN')}đ. Đến quầy thư viện để thanh toán và mở khóa thẻ bạn nhé!`,
    data: {
      bookTitle,
      fineAmount,
      daysOverdue,
      borrowRecordId,
    },
  });

  // Send fine email
  if (patronEmail) {
    try {
      await emailClient.sendFineEmail(patronEmail, bookTitle || 'Sách', fineAmount, daysOverdue || 0);
    } catch (err) {
      console.error(`[fineNotification] Failed to send fine email to ${patronEmail}:`, err);
    }
  }

  return { notified: 1, patronId, fineAmount };
}
