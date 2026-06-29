import axios, { AxiosInstance } from 'axios';
import * as jwt from 'jsonwebtoken';
import { getScopesForService } from './serviceScopes';

export interface ServiceClientConfig {
  serviceName: string;
  jwtSecret: string;
  baseUrl: string;
  expiresInSeconds?: number;
}

export function createServiceClient(config: ServiceClientConfig): AxiosInstance {
  const { serviceName, jwtSecret, baseUrl, expiresInSeconds = 900 } = config;
  const scopes = getScopesForService(serviceName);

  const instance = axios.create({
    baseURL: baseUrl,
    timeout: 10000,
  }) as any;

  // Add request interceptor to attach service token
  instance.interceptors.request.use((requestConfig: any) => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: serviceName,
        scope: scopes,
        iat: now,
        exp: now + expiresInSeconds,
      },
      jwtSecret
    );
    requestConfig.headers = requestConfig.headers || {};
    requestConfig.headers['Authorization'] = `Bearer ${token}`;
    return requestConfig;
  });

  return instance;
}
