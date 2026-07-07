import axios from 'axios';
import { FaceServiceClient } from '../clients/FaceServiceClient';

jest.mock('axios');
jest.mock('../../../shared/auth', () => ({
  getServiceToken: () => 'mock-service-token',
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FaceServiceClient', () => {
  let client: FaceServiceClient;

  beforeEach(() => {
    client = new FaceServiceClient();
    jest.resetAllMocks();
  });

  describe('checkEnrollment', () => {
    it('should return true when user is enrolled', async () => {
      mockedAxios.get.mockResolvedValue({ data: { enrolled: true } });
      const result = await client.checkEnrollment('user-123');
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/internal/face/user-123/status'),
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it('should return false when user is not enrolled', async () => {
      mockedAxios.get.mockResolvedValue({ data: { enrolled: false } });
      const result = await client.checkEnrollment('user-123');
      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      const result = await client.checkEnrollment('user-123');
      expect(result).toBe(false);
    });

    it('should return false without calling API when circuit is open', async () => {
      jest.useFakeTimers();

      // 3 consecutive 5xx to open circuit
      mockedAxios.get.mockRejectedValue({
        response: { status: 503 },
        message: 'Service Unavailable',
      });
      for (let i = 0; i < 3; i++) {
        await client.checkEnrollment(`user-${i}`);
      }

      // Clear call history
      mockedAxios.get.mockClear();

      // Circuit open → should return false WITHOUT calling axios
      const result = await client.checkEnrollment('user-circuit-open');
      expect(result).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should recover after cooldown', async () => {
      jest.useFakeTimers();

      // 3 errors to open
      mockedAxios.get.mockRejectedValue({
        response: { status: 503 },
        message: 'Service Unavailable',
      });
      for (let i = 0; i < 3; i++) {
        await client.checkEnrollment(`user-${i}`);
      }

      // Advance past cooldown
      jest.advanceTimersByTime(30001);

      // Should recover
      mockedAxios.get.mockResolvedValue({ data: { enrolled: true } });
      const result = await client.checkEnrollment('user-recovered');
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('checkEnrollmentBatch', () => {
    it('should return empty object for empty input', async () => {
      const result = await client.checkEnrollmentBatch([]);
      expect(result).toEqual({});
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should call batch endpoint and return statuses', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { statuses: { 'user-1': true, 'user-2': false } },
      });
      const result = await client.checkEnrollmentBatch(['user-1', 'user-2']);
      expect(result).toEqual({ 'user-1': true, 'user-2': false });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/patrons/internal/batch-status'),
        { user_ids: ['user-1', 'user-2'] },
        expect.objectContaining({ timeout: 10000 }),
      );
    });

    it('should return all false on error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Service down'));
      const result = await client.checkEnrollmentBatch(['user-1', 'user-2']);
      expect(result).toEqual({ 'user-1': false, 'user-2': false });
    });

    it('should return all-false map without calling API when circuit is open', async () => {
      jest.useFakeTimers();

      // 3 consecutive errors to open circuit (via checkEnrollment)
      mockedAxios.get.mockRejectedValue({
        response: { status: 503 },
        message: 'Service Unavailable',
      });
      for (let i = 0; i < 3; i++) {
        await client.checkEnrollment(`user-${i}`);
      }

      mockedAxios.post.mockClear();

      // Circuit open → batch should return all false WITHOUT calling axios
      const result = await client.checkEnrollmentBatch(['user-a', 'user-b']);
      expect(result).toEqual({ 'user-a': false, 'user-b': false });
      expect(mockedAxios.post).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
