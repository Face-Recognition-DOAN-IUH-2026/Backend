import { accessClient } from '../clients/serviceClients';
import { toUtcDateStr } from '../../../shared/utils/date';

export async function recognitionStatsRollup(config: Record<string, any>): Promise<any> {
  let targetDate = config?.target_date;
  if (!targetDate) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    targetDate = toUtcDateStr(yesterday);
  }

  try {
    const result = await accessClient.rollupRecognition(targetDate);
    return {
      success: true,
      date: targetDate,
      result,
    };
  } catch (error: any) {
    console.error(`[recognitionStatsRollup] Failed to rollup recognition for ${targetDate}:`, error.message);
    throw error;
  }
}
