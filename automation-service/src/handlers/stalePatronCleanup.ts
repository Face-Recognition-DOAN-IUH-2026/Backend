import { accessClient } from '../clients/serviceClients';

const MAX_INSIDE_HOURS = 24;

export async function stalePatronCleanup(config: Record<string, any>): Promise<any> {
  const maxHours = config.max_inside_hours || MAX_INSIDE_HOURS;

  let activePatrons;
  try {
    activePatrons = await accessClient.getActivePatrons();
  } catch (error) {
    console.error('[stalePatronCleanup] Failed to fetch active patrons:', error);
    throw error;
  }

  const patronList = Array.isArray(activePatrons) ? activePatrons : (activePatrons as any)?.items || [];

  if (patronList.length === 0) {
    return { checked: 1, cleaned: 0, message: 'No patrons currently inside' };
  }

  const now = Date.now();
  const staleThreshold = now - maxHours * 60 * 60 * 1000;
  const stalePatrons = patronList.filter((p: any) => {
    const entryTime = new Date(p.last_entry_at || p.lastEntryAt || p.entered_at).getTime();
    return entryTime < staleThreshold;
  });

  if (stalePatrons.length === 0) {
    return { checked: 1, cleaned: 0, message: `No stale patrons (>${maxHours}h)` };
  }

  const results = await Promise.allSettled(
    stalePatrons.map((patron: any) =>
      accessClient.forceExitPatron(patron.id || patron.patron_id)
    )
  );

  const cleaned = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;

  return {
    checked: 1,
    cleaned,
    failed,
    stale_count: stalePatrons.length,
    max_hours: maxHours,
    message: `Auto-exited ${cleaned} stale patrons${failed > 0 ? `, ${failed} failed` : ''}`,
  };
}
