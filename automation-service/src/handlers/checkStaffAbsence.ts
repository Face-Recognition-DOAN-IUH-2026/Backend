import { scheduleClient, notificationClient, userClient } from '../clients/serviceClients';
import { toUtcDateStr } from '../../../shared/utils/date';

export async function checkStaffAbsence(config: Record<string, any>): Promise<any> {
  let assignments;
  try {
    assignments = await scheduleClient.getTodayAssignments();
  } catch (error) {
    console.error('[checkStaffAbsence] Failed to fetch schedule:', error);
    throw error;
  }

  const assignmentList = Array.isArray(assignments) ? assignments : (assignments as any)?.items || [];

  if (assignmentList.length === 0) {
    return { checked: 0, alerted: 0, message: 'No assignments today' };
  }

  const now = new Date();
  const absentStaff: Array<{ staffId: string; shiftName: string; scheduledTime: string }> = [];

  for (const assignment of assignmentList) {
    const status = assignment.status;
    const staffId = assignment.staff_id || assignment.staffId;

    // If scheduled but not confirmed and shift has started
    if (status === 'scheduled' && assignment.shift_start) {
      const shiftStart = new Date(assignment.shift_start);
      const gracePeriod = 15 * 60 * 1000; // 15 minutes grace

      if (now.getTime() > shiftStart.getTime() + gracePeriod) {
        absentStaff.push({
          staffId,
          shiftName: assignment.shift_name || assignment.shiftName || 'Ca trực',
          scheduledTime: assignment.shift_start,
        });
      }
    }
  }

  if (absentStaff.length === 0) {
    return { checked: assignmentList.length, alerted: 0, message: 'All staff present or within grace period' };
  }

  // Get admin user IDs dynamically
  let adminUserIds: string[] = config.admin_user_ids || [];

  if (adminUserIds.length === 0) {
    try {
      const admins = await userClient.getUsersByRole('admin');
      adminUserIds = Array.isArray(admins) ? admins.map((u: any) => u.id) : [];
    } catch (err) {
      console.warn('[checkStaffAbsence] Failed to fetch admin users:', (err as Error)?.message || err);
    }
  }

  if (adminUserIds.length > 0) {
    const absentList = absentStaff
      .map((s) => `- ${s.staffId} (${s.shiftName} lúc ${s.scheduledTime})`)
      .join('\n');

    const notifications = adminUserIds.map((userId) => ({
      userId,
      type: 'anomaly_alert',
      title: `Cảnh báo: ${absentStaff.length} nhân viên vắng mặt`,
      body: `Nhân viên không check-in sau 15 phút:\n${absentList}`,
      data: { absentStaff, date: toUtcDateStr() },
    }));

    await notificationClient.createBulkNotifications(notifications);
  }

  return { checked: assignmentList.length, alerted: absentStaff.length, absentStaff };
}
