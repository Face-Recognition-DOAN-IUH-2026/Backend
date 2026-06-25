import express from 'express';
import request from 'supertest';
import { swaggerSpec } from '../config/swagger';

function createAppWithSwagger() {
  const app = express();
  app.get('/swagger.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
  return app;
}

describe('Swagger Documentation', () => {
  let app: express.Application;

  beforeAll(() => {
    app = createAppWithSwagger();
  });

  it('should return valid OpenAPI spec JSON', async () => {
    const response = await request(app).get('/swagger.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.0');
    expect(response.body.info).toBeDefined();
    expect(response.body.info.title).toBeDefined();
  });

  it('should include paths from JSDoc comments', async () => {
    const response = await request(app).get('/swagger.json');
    expect(response.status).toBe(200);
    expect(response.body.paths).toBeDefined();
    expect(Object.keys(response.body.paths).length).toBeGreaterThan(0);
  });
});
