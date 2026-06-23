import { detectAnomalies, sendAnomalyAlert, processAnomalyDetection } from '../../services/AnomalyAlertService';

jest.mock('../../data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue([]),
    }),
  },
}));

describe('AnomalyAlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Gap 13: Anomaly Alerts', () => {
    describe('detectAnomalies', () => {
      it('should return empty anomalies when no recent logs', async () => {
        const result = await detectAnomalies('patron-123');

        expect(result.anomalies).toHaveLength(0);
        expect(result.totalChecked).toBe(0);
      });

      it('should detect frequent entry anomaly', async () => {
        const mockLogs = Array(5).fill(null).map((_, i) => ({
          id: `log-${i}`,
          patronId: 'patron-123',
          accessType: 'entry',
          status: 'success',
          accessTime: new Date(),
        }));

        const mockRepo = {
          find: jest.fn().mockResolvedValue(mockLogs),
        };

        const { AppDataSource } = require('../../data-source');
        AppDataSource.getRepository.mockReturnValue(mockRepo);

        const result = await detectAnomalies('patron-123');

        expect(result.anomalies.length).toBeGreaterThan(0);
        expect(result.anomalies[0].alertType).toBe('frequent_entry');
        expect(result.anomalies[0].severity).toBe('medium');
      });

      it('should detect frequent exit anomaly', async () => {
        const mockLogs = Array(5).fill(null).map((_, i) => ({
          id: `log-${i}`,
          patronId: 'patron-123',
          accessType: 'exit',
          status: 'success',
          accessTime: new Date(),
        }));

        const mockRepo = {
          find: jest.fn().mockResolvedValue(mockLogs),
        };

        const { AppDataSource } = require('../../data-source');
        AppDataSource.getRepository.mockReturnValue(mockRepo);

        const result = await detectAnomalies('patron-123');

        expect(result.anomalies.length).toBeGreaterThan(0);
        const exitAnomaly = result.anomalies.find(a => a.alertType === 'frequent_exit');
        expect(exitAnomaly).toBeDefined();
        expect(exitAnomaly?.severity).toBe('medium');
      });

      it('should detect multiple denials anomaly', async () => {
        const mockLogs = Array(3).fill(null).map((_, i) => ({
          id: `log-${i}`,
          patronId: 'patron-123',
          accessType: 'entry',
          status: 'no_match',
          accessTime: new Date(),
        }));

        const mockRepo = {
          find: jest.fn().mockResolvedValue(mockLogs),
        };

        const { AppDataSource } = require('../../data-source');
        AppDataSource.getRepository.mockReturnValue(mockRepo);

        const result = await detectAnomalies('patron-123');

        expect(result.anomalies.length).toBeGreaterThan(0);
        const denialAnomaly = result.anomalies.find(a => a.alertType === 'multiple_denials');
        expect(denialAnomaly).toBeDefined();
        expect(denialAnomaly?.severity).toBe('high');
      });
    });

    describe('sendAnomalyAlert', () => {
      it('should send alert successfully', async () => {
        const alert = {
          id: 'anomaly-123',
          patronId: 'patron-123',
          alertType: 'frequent_entry',
          severity: 'medium' as const,
          message: 'Test alert',
          metadata: {},
          createdAt: new Date(),
        };

        const result = await sendAnomalyAlert(alert);

        expect(result.sent).toBe(true);
        expect(result.alertId).toBe('anomaly-123');
      });
    });

    describe('processAnomalyDetection', () => {
      it('should process detection and return alerts', async () => {
        const mockLogs = Array(5).fill(null).map((_, i) => ({
          id: `log-${i}`,
          patronId: 'patron-123',
          accessType: 'entry',
          status: 'success',
          accessTime: new Date(),
        }));

        const mockRepo = {
          find: jest.fn().mockResolvedValue(mockLogs),
        };

        const { AppDataSource } = require('../../data-source');
        AppDataSource.getRepository.mockReturnValue(mockRepo);

        const result = await processAnomalyDetection('patron-123');

        expect(result.processed).toBe(5);
        expect(result.alerts.length).toBeGreaterThan(0);
      });
    });
  });
});
