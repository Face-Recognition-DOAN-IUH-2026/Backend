import axios from 'axios';
import { config } from '../config';
import { getServiceToken } from '../../../shared/auth';

export class FaceServiceClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.faceRecognitionServiceUrl || 'http://face-recognition-service:5000';
  }

  async checkEnrollment(userId: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/internal/face/${userId}/status`,
        {
          headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
          timeout: 5000,
        }
      );
      return response.data.enrolled || false;
    } catch (error) {
      console.error(`[FaceServiceClient] Failed to check enrollment for user ${userId}:`, error);
      return false;
    }
  }

  async checkEnrollmentBatch(userIds: string[]): Promise<Record<string, boolean>> {
    if (userIds.length === 0) return {};
    try {
      const response = await axios.post(
        `${this.baseUrl}/patrons/internal/batch-status`,
        { user_ids: userIds },
        {
          headers: { 'Authorization': `Bearer ${getServiceToken('user-service', config.jwtSecret)}` },
          timeout: 10000,
        }
      );
      return response.data.statuses || {};
    } catch (error) {
      console.error('[FaceServiceClient] Batch enrollment check failed:', error);
      const fallback: Record<string, boolean> = {};
      for (const id of userIds) fallback[id] = false;
      return fallback;
    }
  }
}

export const faceServiceClient = new FaceServiceClient();
