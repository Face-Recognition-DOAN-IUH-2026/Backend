import { accessClient, notificationClient, userClient } from '../clients/serviceClients';

export async function accessAnomalyAlert(config: Record<string, any>): Promise<any> {
  let activePatrons;
  try {
    activePatrons = await accessClient.getActivePatrons();
  } catch {
    return { checked: 0, alerts: 0, message: 'Failed to fetch active patrons' };
  }

  const patronList = Array.isArray(activePatrons) ? activePatrons : (activePatrons as any)?.items || [];

  if (patronList.length === 0) {
    return { checked: 1, alerts: 0, message: 'No patrons currently inside' };
  }

  // Get admin user IDs dynamically
  let adminUserIds: string[] = config.admin_user_ids || [];

  if (adminUserIds.length === 0) {
    try {
      const admins = await userClient.getUsersByRole('admin');
      adminUserIds = Array.isArray(admins) ? admins.map((u: any) => u.id) : [];
    } catch {}
  }

  if (adminUserIds.length > 0) {
    const now = new Date();
    const hour = now.getHours();
    const formattedList = patronList
      .map((p: any) => `- ${p.full_name || p.patron_id || 'Unknown'} (${p.camera_id || 'N/A'})`)
      .join('\n');

    const notifications = adminUserIds.map((userId) => ({
      userId,
      type: 'anomaly_alert',
      title: `Cảnh báo: ${patronList.length} người trong thư viện`,
      body: `Phát hiện ${patronList.length} người trong thư viện (${hour}h):\n${formattedList}`,
      data: { patrons: patronList, hour, timestamp: now.toISOString() },
    }));

    await notificationClient.createBulkNotifications(notifications);
  }

  return { checked: 1, alerts: 1, activePatrons: patronList.length };
}
