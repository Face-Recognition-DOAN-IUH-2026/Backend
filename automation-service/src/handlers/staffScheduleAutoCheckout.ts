import { scheduleClient } from '../clients/serviceClients';

export async function staffScheduleAutoCheckout(config: Record<string, any>): Promise<any> {
  try {
    const result = await scheduleClient.autoCheckout();
    return {
      checked: 1,
      success: true,
      result,
      message: `Auto-checkout completed: ${JSON.stringify(result)}`,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error('Auto-checkout request timed out after 30s');
    }
    throw error;
  }
}
