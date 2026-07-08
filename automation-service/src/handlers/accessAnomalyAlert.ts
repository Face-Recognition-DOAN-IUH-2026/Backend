import { accessClient, notificationClient, userClient } from '../clients/serviceClients';

const STALE_HOURS = 8;

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

  const now = Date.now();
  const staleThreshold = now - STALE_HOURS * 60 * 60 * 1000;
  const stalePatrons = patronList.filter((p: any) => {
    const entryTime = new Date(p.last_entry_at || p.lastEntryAt || p.entered_at).getTime();
    return entryTime < staleThreshold;
  });

  if (stalePatrons.length === 0) {
    return { checked: 1, alerts: 0, message: `No stale patrons (>${STALE_HOURS}h)` };
  }

  let adminUserIds: string[] = config.admin_user_ids || [];

  if (adminUserIds.length === 0) {
    try {
      const admins = await userClient.getUsersByRole('admin');
      adminUserIds = Array.isArray(admins) ? admins.map((u: any) => u.id) : [];
    } catch (err) {
      console.warn('[accessAnomalyAlert] Failed to fetch admin users:', (err as Error)?.message || err);
    }
  }

  if (adminUserIds.length > 0) {
    const formattedList = stalePatrons
      .map((p: any) => {
        const entryTime = new Date(p.last_entry_at || p.lastEntryAt || p.entered_at).getTime();
        const hours = Math.round((now - entryTime) / (1000 * 60 * 60));
        return `- ${p.full_name || p.student_code || p.patron_id || 'Unknown'} (${hours}h, ${p.last_entry_camera || p.lastEntryCamera || 'không rõ'})`;
      })
      .join('\n');

    const notifications = adminUserIds.map((userId) => ({
      userId,
      type: 'anomaly_alert',
      title: `Cảnh báo: ${stalePatrons.length} độc giả ở quá ${STALE_HOURS}h`,
      body: `Phát hiện ${stalePatrons.length} độc giả ở trong thư viện quá ${STALE_HOURS} giờ:\n${formattedList}\n\nCó thể gate không detect exit. Kiểm tra trang "Đang hiện diện".`,
      data: { stale_patrons: stalePatrons, timestamp: new Date().toISOString() },
    }));

    await notificationClient.createBulkNotifications(notifications);
  }

  return { checked: 1, alerts: 1, total_inside: patronList.length, stale_count: stalePatrons.length };
}
