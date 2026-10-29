import { userClient, notificationClient, emailClient } from '../clients/serviceClients';

export async function membershipExpiryCheck(taskConfig: Record<string, any>): Promise<any> {
  const daysBefore = taskConfig.days_before || 7;

  try {
    const users = await userClient.getExpiringMemberships(daysBefore);

    if (!Array.isArray(users) || users.length === 0) {
      return { checked: 0, notified: 0, message: 'No expiring memberships' };
    }

    const notifications = users.map((user: any) => ({
      userId: user.id,
      type: 'membership_expiry',
      title: 'Thẻ thư viện sắp hết hạn',
      body: `Thẻ thư viện của bạn sẽ hết hạn vào ngày ${new Date(user.membershipExpiry).toLocaleDateString('vi-VN')}. Vui lòng gia hạn tại quầy thủ thư.`,
      data: { expiryDate: user.membershipExpiry, daysLeft: daysBefore },
    }));

    const emailPromises = users
      .filter((user: any) => user.email)
      .map((user: any) =>
        emailClient.sendMembershipExpiryEmail(user.email, user.membershipExpiry).catch((err: any) => {
          console.error(`[membershipExpiryCheck] Failed to send expiry email to ${user.email}:`, err);
        })
      );

    await Promise.allSettled(emailPromises);
    await notificationClient.createBulkNotifications(notifications);

    return { checked: users.length, notified: notifications.length };
  } catch (error) {
    console.error('[membershipExpiryCheck] Failed to fetch expiring memberships:', error);
    throw error;
  }
}
