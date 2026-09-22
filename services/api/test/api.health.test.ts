import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/main';

describe('API Health', () => {
  it('GET /v1/health returns 200', async () => {
    const res = await request(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('shoot-the-ball-api');
  });

  it('GET / returns version info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('shoot-the-ball-api');
    expect(res.body.version).toBe('0.1.0');
  });

  it('GET /v1/nonexistent returns 404', async () => {
    const res = await request(app).get('/v1/nonexistent');
    expect(res.status).toBe(404);
  });
});
