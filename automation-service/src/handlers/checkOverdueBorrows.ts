import { borrowClient, notificationClient, userClient, emailClient } from '../clients/serviceClients';

export async function checkOverdueBorrows(config: Record<string, any>): Promise<any> {
  const overdue = await borrowClient.getOverdueBorrows();

  if (!overdue || !Array.isArray(overdue) || overdue.length === 0) {
    return { checked: 0, notified: 0, message: 'No overdue borrows' };
  }

  const notifications: Array<{ userId: string; type: string; title: string; body: string; data: Record<string, any> }> = [];

  for (const record of overdue) {
    const patronId = record.patron_id || record.patronId;
    if (!patronId) continue;

    let patronName = 'Bạn';
    let patronEmail = '';
    try {
      const patron = await userClient.getUser(patronId);
      if (patron?.fullName) patronName = patron.fullName;
      if (patron?.email) patronEmail = patron.email;
    } catch {}

    const bookTitle = record.title || record.book_title || record.book?.title || 'Sách';
    const dueDate = record.due_at || record.dueAt;
    const daysOverdue = dueDate
      ? Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    notifications.push({
      userId: patronId,
      type: 'overdue_reminder',
      title: 'Sách quá hạn',
      body: `${patronName}, cuốn "${bookTitle}" đã quá hạn ${daysOverdue} ngày. Vui lòng trả sách sớm để tránh phí phạt.`,
      data: {
        bookId: record.book_id || record.bookId,
        borrowRecordId: record.id,
        dueAt: dueDate,
        daysOverdue,
      },
    });

    // Send overdue email
    if (patronEmail) {
      try {
        await emailClient.sendOverdueEmail(patronEmail, bookTitle, daysOverdue);
      } catch (err) {
        console.error(`[checkOverdueBorrows] Failed to send overdue email to ${patronEmail}:`, err);
      }
    }
  }

  if (notifications.length > 0) {
    await notificationClient.createBulkNotifications(notifications);
  }

  return { checked: overdue.length, notified: notifications.length };
}
