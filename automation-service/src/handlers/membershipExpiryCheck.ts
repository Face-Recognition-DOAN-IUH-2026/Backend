import { userClient, notificationClient } from '../clients/serviceClients';
import { config as appConfig } from '../config';

export async function membershipExpiryCheck(taskConfig: Record<string, any>): Promise<any> {
  const daysBefore = taskConfig.days_before || 7;

  try {
    const response = await fetch(
      `${appConfig.services.userService}/internal/users/expiring-membership?days=${daysBefore}`,
      {
        headers: {
          'x-internal-api-key': appConfig.internalApiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return { checked: 0, notified: 0, message: 'Failed to query expiring memberships' };
    }

    const users = await response.json();

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

    await notificationClient.createBulkNotifications(notifications);

    return { checked: users.length, notified: notifications.length };
  } catch {
    return { checked: 0, notified: 0, message: 'Error checking membership expiry' };
  }
}
