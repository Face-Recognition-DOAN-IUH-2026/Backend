import { borrowClient, notificationClient, userClient, emailClient } from '../clients/serviceClients';

export async function checkOverdueBorrows(config: Record<string, any>): Promise<any> {
  const overdue = await borrowClient.getOverdueBorrows();

  if (!overdue || !Array.isArray(overdue) || overdue.length === 0) {
    return { checked: 0, notified: 0, message: 'No overdue borrows' };
  }

  const uniquePatronIds = [...new Set(
    overdue.map((r: any) => r.patron_id || r.patronId).filter(Boolean)
  )];

  let patronMap: Record<string, any> = {};
  if (uniquePatronIds.length > 0) {
    try {
      patronMap = await userClient.getUsers(uniquePatronIds);
    } catch (err) {
      console.error('[checkOverdueBorrows] Failed to batch fetch patrons:', err);
    }
  }

  const notifications: Array<{ userId: string; type: string; title: string; body: string; data: Record<string, any> }> = [];
  const emailPromises: Promise<any>[] = [];

  for (const record of overdue) {
    const patronId = record.patron_id || record.patronId;
    if (!patronId) continue;

    const patron = patronMap[patronId];
    const patronName = patron?.fullName || 'Bạn';
    const patronEmail = patron?.email || '';

    const bookTitle = record.title || record.book_title || record.book?.title || 'Sách';
    const dueDate = record.due_at || record.dueAt;
    const daysOverdue = dueDate
      ? Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    notifications.push({
      userId: patronId,
      type: 'overdue_reminder',
      title: 'Nhắc trả sách',
      body: `${patronName}, cuốn "${bookTitle}" đã quá hạn ${daysOverdue} ngày. Vui lòng trả sách sớm để tránh phí thêm. Bạn có thể trả tại quầy thư viện hoặc máy trả sách tự động.`,
      data: {
        bookId: record.book_id || record.bookId,
        borrowRecordId: record.id,
        dueAt: dueDate,
        daysOverdue,
      },
    });

    if (patronEmail) {
      emailPromises.push(
        emailClient.sendOverdueEmail(patronEmail, bookTitle, daysOverdue).catch((err: any) => {
          console.error(`[checkOverdueBorrows] Failed to send overdue email to ${patronEmail}:`, err);
        })
      );
    }
  }

  await Promise.allSettled(emailPromises);

  if (notifications.length > 0) {
    await notificationClient.createBulkNotifications(notifications);
  }

  return { checked: overdue.length, notified: notifications.length };
}
