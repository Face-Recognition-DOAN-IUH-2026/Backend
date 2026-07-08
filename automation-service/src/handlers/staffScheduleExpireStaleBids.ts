import { scheduleClient, notificationClient } from '../clients/serviceClients';

export async function staffScheduleExpireStaleBids(config: Record<string, any>): Promise<any> {
  const warnHours = config.warn_hours || 48;
  const expireHours = config.expire_hours || 72;

  try {
    const staleBids = await scheduleClient.getStaleBids(warnHours, expireHours);
    if (!Array.isArray(staleBids) || staleBids.length === 0) {
      return { warned: 0, expired: 0, message: 'No stale bids' };
    }

    let warned = 0;
    let expired = 0;

    for (const bid of staleBids) {
      if (bid.status === 'pending' && bid.hours_since_created >= expireHours) {
        try {
          await scheduleClient.expireBid(bid.id);
          expired++;
        } catch (err) {
          console.warn('[staffScheduleExpireStaleBids] Failed to expire bid:', (err as Error)?.message || err);
        }
      } else if (bid.status === 'pending' && bid.hours_since_created >= warnHours) {
        try {
          await notificationClient.createNotification({
            userId: bid.staff_id || bid.staffId,
            type: 'bid_warning',
            title: 'Sắp hết hạn đăng ký ca',
            body: `Phiếu đăng ký ca "${bid.shift_name || bid.shiftName || ''}" sắp hết hạn sau ${expireHours - bid.hours_since_created} giờ.`,
            data: { bidId: bid.id, shiftId: bid.shift_id || bid.shiftId },
          });
          warned++;
        } catch (err) {
          console.warn('[staffScheduleExpireStaleBids] Failed to warn bid:', (err as Error)?.message || err);
        }
      }
    }

    return { warned, expired, total: staleBids.length };
  } catch (err) {
    console.error('[staffScheduleExpireStaleBids] Failed:', (err as Error)?.message || err);
    return { warned: 0, expired: 0, message: 'Stale bids check failed' };
  }
}
