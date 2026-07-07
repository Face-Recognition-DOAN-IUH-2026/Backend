import axios from 'axios';
import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';
import { CircuitBreaker } from '../../../shared/utils/circuitBreaker';

export class FaceServiceClient {
  private baseUrl: string;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.baseUrl = config.faceRecognitionServiceUrl || 'http://face-recognition-service:5000';
    this.circuitBreaker = new CircuitBreaker(3, 30_000);
  }

  async checkEnrollment(userId: string): Promise<boolean> {
    if (!this.circuitBreaker.canRequest()) {
      return false;
    }
    try {
      const response = await axios.get(
        `${this.baseUrl}/internal/face/${userId}/status`,
        {
          headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
          timeout: 5000,
        }
      );
      this.circuitBreaker.recordSuccess();
      return response.data.enrolled || false;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      console.error(`[FaceServiceClient] Failed to check enrollment for user ${userId}:`, error);
      return false;
    }
  }

  async checkEnrollmentBatch(userIds: string[]): Promise<Record<string, boolean>> {
    if (userIds.length === 0) return {};
    if (!this.circuitBreaker.canRequest()) {
      const fallback: Record<string, boolean> = {};
      for (const id of userIds) fallback[id] = false;
      return fallback;
    }
    try {
      const response = await axios.post(
        `${this.baseUrl}/patrons/internal/batch-status`,
        { user_ids: userIds },
        {
          headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
          timeout: 10000,
        }
      );
      this.circuitBreaker.recordSuccess();
      return response.data.statuses || {};
    } catch (error) {
      this.circuitBreaker.recordFailure();
      console.error('[FaceServiceClient] Batch enrollment check failed:', error);
      const fallback: Record<string, boolean> = {};
      for (const id of userIds) fallback[id] = false;
      return fallback;
    }
  }
}

export const faceServiceClient = new FaceServiceClient();
