import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { createAuth } from '../../../../shared/auth';
import { errorHandler } from '../../../../shared/error-handler';
import { AppDataSource } from '../../data-source';
import scheduleRouter from '../../routes/schedule.routes';
import { scheduleService } from '../../services/ScheduleService';
import { config } from '../../config';

jest.mock('../../data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));
jest.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    listPreferences: jest.fn().mockResolvedValue({ items: [] }),
    createPreference: jest.fn().mockResolvedValue({ id: 'p1' }),
    deletePreference: jest.fn().mockResolvedValue({ deleted: true, id: 'p1' }),
    getPreferenceById: jest.fn().mockResolvedValue({ id: 'p1', staffId: 'u2' }),
    checkIn: jest.fn().mockResolvedValue({}),
    checkOut: jest.fn().mockResolvedValue({}),
    setGeofence: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock('../../config', () => ({
  config: {
    jwtSecret: 'test-secret',
    jwtAudience: 'face-recognition-users',
    jwtIssuer: 'face-recognition',
  },
}));

function signToken(role: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: 'u1', roles: [role], iss: 'face-recognition', aud: 'face-recognition-users', typ: 'access', iat: now, exp: now + 3600 },
    config.jwtSecret
  );
}

describe('schedule routes validation (#16)', () => {
  let app: express.Express;

  beforeAll(() => {
    const auth = createAuth({ jwtSecret: 'test-secret', jwtAudience: 'face-recognition-users', jwtIssuer: 'face-recognition' });
    app = express();
    app.use(express.json());
    app.use('/schedules', auth, scheduleRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /schedules/preferences rejects missing shiftId', async () => {
    const res = await request(app)
      .post('/schedules/preferences')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ zoneId: 'z1', priority: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects missing zoneId', async () => {
    const res = await request(app)
      .post('/schedules/preferences')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ shiftId: 's1', priority: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects non-uuid shiftId', async () => {
    const res = await request(app)
      .post('/schedules/preferences')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ shiftId: 'not-a-uuid', zoneId: 'z1', priority: 1 });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects out-of-range priority', async () => {
    const res = await request(app)
      .post('/schedules/preferences')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ shiftId: 's1', zoneId: 'z1', priority: 9999 });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects NaN lat in check-in', async () => {
    const res = await request(app)
      .post('/schedules/assignments/a1/check-in')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ lat: 'abc', lng: 10 });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects NaN lng in check-in', async () => {
    const res = await request(app)
      .post('/schedules/assignments/a1/check-in')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ lat: 10, lng: 'abc' });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects out-of-range lat', async () => {
    const res = await request(app)
      .post('/schedules/assignments/a1/check-in')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ lat: 999, lng: 10 });
    expect(res.status).toBe(400);
  });

  it('POST /schedules/preferences rejects out-of-range lng', async () => {
    const res = await request(app)
      .post('/schedules/assignments/a1/check-in')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ lat: 10, lng: 999 });
    expect(res.status).toBe(400);
  });

  it('DELETE /schedules/preferences/:id rejects non-uuid id', async () => {
    const res = await request(app)
      .delete('/schedules/preferences/not-a-uuid')
      .set('Authorization', `Bearer ${signToken('staff')}`);
    expect(res.status).toBe(400);
  });

  it('DELETE /schedules/preferences/:id staff cannot delete another staff preference', async () => {
    (scheduleService.getPreferenceById as jest.Mock).mockResolvedValueOnce({ id: '550e8400-e29b-41d4-a716-446655440099', staffId: 'u2' });
    const res = await request(app)
      .delete('/schedules/preferences/550e8400-e29b-41d4-a716-446655440099')
      .set('Authorization', `Bearer ${signToken('staff')}`);
    expect(res.status).toBe(403);
  });

  it('POST /schedules/preferences valid body succeeds', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const res = await request(app)
      .post('/schedules/preferences')
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ shiftId: uuid, zoneId: uuid, priority: 1 });
    expect(res.status).toBe(201);
  });

  it('POST /schedules/assignments/:id/check-in with valid lat/lng succeeds', async () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    (scheduleService.checkIn as jest.Mock).mockResolvedValueOnce({});
    const res = await request(app)
      .post(`/schedules/assignments/${uuid}/check-in`)
      .set('Authorization', `Bearer ${signToken('staff')}`)
      .send({ lat: 10.7769, lng: 106.6953 });
    expect(res.status).toBe(200);
  });
});
