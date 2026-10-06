import { accessClient } from '../clients/serviceClients';

export async function recognitionStatsRollup(config: Record<string, any>): Promise<any> {
  let targetDate = config?.target_date;
  if (!targetDate) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    targetDate = yesterday.toISOString().split('T')[0];
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
    return {
      success: false,
      date: targetDate,
      error: error.message || 'Unknown error',
    };
  }
}
