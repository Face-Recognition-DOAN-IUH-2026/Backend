import { recognitionStatsRollup } from '../../handlers/recognitionStatsRollup';
import { accessClient } from '../../clients/serviceClients';

jest.mock('../../clients/serviceClients', () => ({
  accessClient: {
    rollupRecognition: jest.fn(),
  },
}));

describe('recognitionStatsRollup handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls accessClient.rollupRecognition with yesterday date by default', async () => {
    (accessClient.rollupRecognition as jest.Mock).mockResolvedValue({
      date: '2026-10-05',
      cameras: [{ camera_id: 'entry_gate', granted: 10 }],
    });

    const result = await recognitionStatsRollup({});

    expect(accessClient.rollupRecognition).toHaveBeenCalled();
    const calledDate = (accessClient.rollupRecognition as jest.Mock).mock.calls[0][0];
    expect(calledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.success).toBe(true);
  });

  it('uses target_date from config if provided', async () => {
    (accessClient.rollupRecognition as jest.Mock).mockResolvedValue({
      date: '2026-10-01',
      cameras: [],
    });

    const result = await recognitionStatsRollup({ target_date: '2026-10-01' });

    expect(accessClient.rollupRecognition).toHaveBeenCalledWith('2026-10-01');
    expect(result.success).toBe(true);
  });

  it('catches downstream access-service failure and returns recorded failure without throwing', async () => {
    (accessClient.rollupRecognition as jest.Mock).mockRejectedValue(new Error('Connection refused'));

    const result = await recognitionStatsRollup({});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});
