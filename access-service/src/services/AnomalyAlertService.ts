import { AppDataSource } from '../data-source';
import { AccessLog } from '../entities/AccessLog';

export interface AnomalyAlert {
  id: string;
  patronId: string;
  alertType: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface AnomalyDetectionResult {
  anomalies: AnomalyAlert[];
  totalChecked: number;
}

const logRepo = () => AppDataSource.getRepository(AccessLog);

export async function detectAnomalies(
  patronId: string,
  timeWindowMinutes: number = 60
): Promise<AnomalyDetectionResult> {
  const anomalies: AnomalyAlert[] = [];
  const since = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

  const recentLogs = await logRepo().find({
    where: {
      patronId,
      accessTime: { $gte: since } as any,
    },
    order: { accessTime: 'DESC' },
  });

  if (recentLogs.length === 0) {
    return { anomalies: [], totalChecked: 0 };
  }

  const entryCount = recentLogs.filter((log) => log.accessType === 'entry').length;
  const exitCount = recentLogs.filter((log) => log.accessType === 'exit').length;

  if (entryCount > 3) {
    anomalies.push({
      id: `anomaly-${patronId}-${Date.now()}-frequent-entry`,
      patronId,
      alertType: 'frequent_entry',
      severity: 'medium',
      message: `Patron has ${entryCount} entries in the last ${timeWindowMinutes} minutes`,
      metadata: { entryCount, timeWindowMinutes },
      createdAt: new Date(),
    });
  }

  if (exitCount > 3) {
    anomalies.push({
      id: `anomaly-${patronId}-${Date.now()}-frequent-exit`,
      patronId,
      alertType: 'frequent_exit',
      severity: 'medium',
      message: `Patron has ${exitCount} exits in the last ${timeWindowMinutes} minutes`,
      metadata: { exitCount, timeWindowMinutes },
      createdAt: new Date(),
    });
  }

  const deniedLogs = recentLogs.filter(
    (log) => log.status !== 'success' && log.status !== 'granted'
  );
  if (deniedLogs.length >= 3) {
    anomalies.push({
      id: `anomaly-${patronId}-${Date.now()}-multiple-denials`,
      patronId,
      alertType: 'multiple_denials',
      severity: 'high',
      message: `Patron has ${deniedLogs.length} access denials in the last ${timeWindowMinutes} minutes`,
      metadata: { denialCount: deniedLogs.length, timeWindowMinutes },
      createdAt: new Date(),
    });
  }

  return {
    anomalies,
    totalChecked: recentLogs.length,
  };
}

export async function sendAnomalyAlert(
  alert: AnomalyAlert
): Promise<{ sent: boolean; alertId: string }> {
  console.log(`[AnomalyAlert] ${alert.severity.toUpperCase()}: ${alert.message}`);
  
  return {
    sent: true,
    alertId: alert.id,
  };
}

export async function processAnomalyDetection(
  patronId: string
): Promise<{ processed: number; alerts: AnomalyAlert[] }> {
  const result = await detectAnomalies(patronId);
  
  const sentAlerts: AnomalyAlert[] = [];
  for (const alert of result.anomalies) {
    await sendAnomalyAlert(alert);
    sentAlerts.push(alert);
  }

  return {
    processed: result.totalChecked,
    alerts: sentAlerts,
  };
}
