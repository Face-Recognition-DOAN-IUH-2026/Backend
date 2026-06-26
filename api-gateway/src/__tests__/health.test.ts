import request from 'supertest';
import { app } from '../index';

describe('Health Endpoints', () => {
  describe('GET /healthz', () => {
    it('should return 200 with status ok', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.gateway).toBe('Node.js-API-Gateway');
    });
  });

  describe('GET /', () => {
    it('should return 200 with service info', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Face Recognition Platform API Gateway');
    });
  });

  describe('GET /api/health', () => {
    it('should return 200 with service status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('api-gateway');
    });
  });
});
