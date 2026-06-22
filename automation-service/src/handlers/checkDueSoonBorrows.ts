import { borrowClient, notificationClient, userClient, emailClient } from '../clients/serviceClients';

export async function checkDueSoonBorrows(config: Record<string, any>): Promise<any> {
  const daysBefore = parseInt(config?.days_before) || 3;
  const dueSoon = await borrowClient.getDueSoonBorrows(daysBefore);

  if (!dueSoon || !Array.isArray(dueSoon) || dueSoon.length === 0) {
    return { checked: 0, notified: 0, message: 'No due-soon borrows' };
  }

  const notifications: Array<{ userId: string; type: string; title: string; body: string; data: Record<string, any> }> = [];

  for (const record of dueSoon) {
    const patronId = record.patron_id || record.patronId;
    if (!patronId) continue;

    let patronName = 'Bạn';
    try {
      const patron = await userClient.getUser(patronId);
      if (patron?.fullName) patronName = patron.fullName;
    } catch {}

    const bookTitle = record.title || record.book_title || record.book?.title || 'Sách';
    const dueDate = record.due_at || record.dueAt;
    const daysLeft = dueDate
      ? Math.max(0, Math.ceil((new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;

    notifications.push({
      userId: patronId,
      type: 'due_soon_reminder',
      title: 'Sách sắp đến hạn trả',
      body: `${patronName}, cuốn "${bookTitle}" sẽ hết hạn trả vào ngày ${dueDate ? new Date(dueDate).toLocaleDateString('vi-VN') : 'không xác định'} (còn ${daysLeft} ngày). Vui lòng trả sách đúng hạn.`,
      data: {
        bookId: record.book_id || record.bookId,
        borrowRecordId: record.id,
        dueAt: dueDate,
        daysLeft,
      },
    });
  }

  if (notifications.length > 0) {
    await notificationClient.createBulkNotifications(notifications);
  }

  return { checked: dueSoon.length, notified: notifications.length };
}
