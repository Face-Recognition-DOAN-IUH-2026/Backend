import axios from 'axios';
import { FaceServiceClient } from '../clients/FaceServiceClient';

jest.mock('axios');
jest.mock('../../../shared', () => ({
  getServiceToken: () => 'mock-service-token',
}));
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FaceServiceClient', () => {
  let client: FaceServiceClient;

  beforeEach(() => {
    client = new FaceServiceClient();
    jest.clearAllMocks();
  });

  describe('checkEnrollment', () => {
    it('should return true when user is enrolled', async () => {
      mockedAxios.get.mockResolvedValue({ data: { enrolled: true } });
      const result = await client.checkEnrollment('user-123');
      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/internal/face/user-123/status'),
        expect.objectContaining({ timeout: 5000 })
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
        expect.objectContaining({ timeout: 10000 })
      );
    });

    it('should return all false on error', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Service down'));
      const result = await client.checkEnrollmentBatch(['user-1', 'user-2']);
      expect(result).toEqual({ 'user-1': false, 'user-2': false });
    });
  });
});
