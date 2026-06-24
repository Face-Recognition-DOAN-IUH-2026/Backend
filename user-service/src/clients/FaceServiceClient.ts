import axios from 'axios';
import { config } from '../config';

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
          headers: { 'x-internal-api-key': config.internalApiKey },
          timeout: 5000,
        }
      );
      return response.data.enrolled || false;
    } catch (error) {
      console.error(`[FaceServiceClient] Failed to check enrollment for user ${userId}:`, error);
      return false;
    }
  }
}

export const faceServiceClient = new FaceServiceClient();
