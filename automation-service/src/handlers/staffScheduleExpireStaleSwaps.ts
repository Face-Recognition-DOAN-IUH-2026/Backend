import { scheduleClient, notificationClient } from '../clients/serviceClients';

export async function staffScheduleExpireStaleSwaps(config: Record<string, any>): Promise<any> {
  const warnHours = config.warn_hours || 48;
  const expireHours = config.expire_hours || 72;

  try {
    const staleSwaps = await scheduleClient.getStaleSwaps(warnHours, expireHours);
    if (!Array.isArray(staleSwaps) || staleSwaps.length === 0) {
      return { warned: 0, expired: 0, message: 'No stale swaps' };
    }

    let warned = 0;
    let expired = 0;

    for (const swap of staleSwaps) {
      if (swap.status === 'pending' && swap.hours_since_created >= expireHours) {
        try {
          await scheduleClient.expireSwap(swap.id);
          expired++;
        } catch (err) {
          console.warn('[staffScheduleExpireStaleSwaps] Failed to expire swap:', (err as Error)?.message || err);
        }
      } else if (swap.status === 'pending' && swap.hours_since_created >= warnHours) {
        try {
          await notificationClient.createNotification({
            userId: swap.staff_id || swap.staffId,
            type: 'swap_warning',
            title: 'Sắp hết hạn yêu cầu đổi ca',
            body: `Yêu cầu đổi ca "${swap.shift_name || swap.shiftName || ''}" sắp hết hạn sau ${expireHours - swap.hours_since_created} giờ.`,
            data: { swapId: swap.id, shiftId: swap.shift_id || swap.shiftId },
          });
          warned++;
        } catch (err) {
          console.warn('[staffScheduleExpireStaleSwaps] Failed to warn swap:', (err as Error)?.message || err);
        }
      }
    }

    return { warned, expired, total: staleSwaps.length };
  } catch (err) {
    console.error('[staffScheduleExpireStaleSwaps] Failed:', (err as Error)?.message || err);
    return { warned: 0, expired: 0, message: 'Stale swaps check failed' };
  }
}
