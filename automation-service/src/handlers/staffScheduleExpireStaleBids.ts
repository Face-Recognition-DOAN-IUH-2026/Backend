import { config } from '../config';
import { getServiceToken } from '../../../shared';

export async function staffScheduleExpireStaleBids(taskConfig: Record<string, any>): Promise<any> {
  const url = `${config.services?.scheduleService || 'http://schedule-service:3002'}/schedules/internal/expire-stale-bids`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getServiceToken('automation-service', config.jwtSecret)}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const result = await res.json();
    return {
      checked: 1,
      success: true,
      result,
      message: `Expire stale bids completed: ${JSON.stringify(result)}`,
    };
  } catch (error: any) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new Error('Expire stale bids request timed out after 30s');
    }
    throw error;
  }
}
