import { borrowClient, notificationClient, userClient, emailClient } from '../clients/serviceClients';

function estimateOverdueFine(days: number): number {
  if (days <= 0) return 0;
  if (days <= 7) return 10000;
  if (days <= 14) return 20000;
  if (days <= 30) return 50000;
  return 100000;
}

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
      ? Math.max(1, Math.round((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    // Chỉ gửi thông báo vào ngày đầu tiên (ngày 1) và sau mỗi 3 ngày (ngày 3, 6, 9, 12...)
    const shouldNotify = daysOverdue === 1 || (daysOverdue > 0 && daysOverdue % 3 === 0);
    if (!shouldNotify) continue;

    const fineAmount = estimateOverdueFine(daysOverdue);

    notifications.push({
      userId: patronId,
      type: 'overdue_reminder',
      title: 'Nhắc trả sách quá hạn',
      body: `Bạn đang trễ hạn cuốn sách "${bookTitle}" ${daysOverdue} ngày. Số tiền phạt quá hạn tạm tính là: ${fineAmount.toLocaleString('vi-VN')} đ. Vui lòng đến quầy thư viện trả sách hoặc thanh toán trên ứng dụng.`,
      data: {
        bookId: record.book_id || record.bookId,
        borrowRecordId: record.id,
        dueAt: dueDate,
        daysOverdue,
        fineAmount,
      },
    });

    if (patronEmail) {
      emailPromises.push(
        emailClient.sendOverdueEmail(patronEmail, bookTitle, daysOverdue, fineAmount).catch((err: any) => {
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
