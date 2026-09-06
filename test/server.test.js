import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { createApp, createRateLimiter, isRefererAllowed } from '../src/server.js';

// These tests exercise the sample server's access-control middleware. They
// only hit `/dynamic` (which renders the HTML template), so no headless
// browser is needed.

const POINT = '{"type":"Point","coordinates":[-105.01621,39.57422]}';
const MAP_PATH = `/dynamic?geojson=${encodeURIComponent(POINT)}`;

let server;
let baseUrl;

async function startServer(env = {}) {
  server = http.createServer(createApp(env));
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
}

const get = (path, headers = {}) => fetch(baseUrl + path, { headers });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe('default configuration', () => {
  it('serves maps to anyone when no gate is configured', async () => {
    await startServer({});
    const res = await get(MAP_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('L.geoJson(');
  });

  it('answers the health check', async () => {
    await startServer({});
    const res = await get('/health');
    expect(res.status).toBe(200);
  });
});

describe('HEADER_CHECK', () => {
  it('rejects requests without the expected header', async () => {
    await startServer({ HEADER_CHECK: 'x-api-key:secret' });
    const res = await get(MAP_PATH);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden, set correct header to access');
  });

  it('accepts requests carrying the expected header', async () => {
    await startServer({ HEADER_CHECK: 'x-api-key:secret' });
    const res = await get(MAP_PATH, { 'x-api-key': 'secret' });
    expect(res.status).toBe(200);
  });

  it('honours HEADER_CHECK_FAIL_MESSAGE', async () => {
    await startServer({
      HEADER_CHECK: 'x-api-key:secret',
      HEADER_CHECK_FAIL_MESSAGE: 'ask for a key',
    });
    const res = await get(MAP_PATH);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('ask for a key');
  });
});

describe('ALLOWED_REFERERS', () => {
  it('allows requests referred from an allowed host', async () => {
    await startServer({ ALLOWED_REFERERS: 'example.com, maps.org' });
    const res = await get(MAP_PATH, { Referer: 'https://example.com/some/page' });
    expect(res.status).toBe(200);
  });

  it('rejects requests referred from other hosts', async () => {
    await startServer({ ALLOWED_REFERERS: 'example.com' });
    const res = await get(MAP_PATH, { Referer: 'https://evil.example.net/' });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Forbidden, hotlinking from this site is not allowed');
  });

  it('rejects requests without a Referer by default', async () => {
    await startServer({ ALLOWED_REFERERS: 'example.com' });
    const res = await get(MAP_PATH);
    expect(res.status).toBe(403);
  });

  it('allows requests without a Referer when the list contains "none"', async () => {
    await startServer({ ALLOWED_REFERERS: 'none,example.com' });
    expect((await get(MAP_PATH)).status).toBe(200);
    expect((await get(MAP_PATH, { Referer: 'https://evil.example.net/' })).status).toBe(403);
  });

  it('supports wildcard subdomains', async () => {
    await startServer({ ALLOWED_REFERERS: '*.example.com' });
    expect((await get(MAP_PATH, { Referer: 'https://example.com/' })).status).toBe(200);
    expect((await get(MAP_PATH, { Referer: 'https://a.b.example.com/x' })).status).toBe(200);
    expect((await get(MAP_PATH, { Referer: 'https://notexample.com/' })).status).toBe(403);
    expect((await get(MAP_PATH, { Referer: 'https://example.com.evil.net/' })).status).toBe(403);
  });

  it('accepts full URLs in the allowlist and matches case-insensitively', async () => {
    await startServer({ ALLOWED_REFERERS: 'https://Example.com:8080/path' });
    const res = await get(MAP_PATH, { Referer: 'http://EXAMPLE.com/' });
    expect(res.status).toBe(200);
  });

  it('rejects an unparseable Referer', async () => {
    await startServer({ ALLOWED_REFERERS: 'example.com' });
    const res = await get(MAP_PATH, { Referer: 'not a url' });
    expect(res.status).toBe(403);
  });

  it('honours ALLOWED_REFERERS_FAIL_MESSAGE', async () => {
    await startServer({
      ALLOWED_REFERERS: 'example.com',
      ALLOWED_REFERERS_FAIL_MESSAGE: 'embed only from example.com',
    });
    const res = await get(MAP_PATH, { Referer: 'https://evil.example.net/' });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('embed only from example.com');
  });

  it('never blocks the health check', async () => {
    await startServer({ ALLOWED_REFERERS: 'example.com' });
    expect((await get('/health')).status).toBe(200);
  });

  it('isRefererAllowed passes everything when no allowlist is configured', () => {
    expect(isRefererAllowed(undefined, null)).toBe(true);
    expect(isRefererAllowed('https://anything.test/', null)).toBe(true);
  });
});

describe('RATE_LIMIT_MAX', () => {
  it('returns 429 with Retry-After once the per-IP budget is exhausted', async () => {
    await startServer({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW: '60' });
    expect((await get(MAP_PATH)).status).toBe(200);
    expect((await get(MAP_PATH)).status).toBe(200);
    const res = await get(MAP_PATH);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(await res.text()).toBe('Too many requests, slow down');
  });

  it('counts clients separately using X-Forwarded-For', async () => {
    await startServer({ RATE_LIMIT_MAX: '1' });
    expect((await get(MAP_PATH, { 'X-Forwarded-For': '10.0.0.1, 10.0.0.9' })).status).toBe(200);
    expect((await get(MAP_PATH, { 'X-Forwarded-For': '10.0.0.1' })).status).toBe(429);
    expect((await get(MAP_PATH, { 'X-Forwarded-For': '10.0.0.2' })).status).toBe(200);
  });

  it('does not count the health check against the budget', async () => {
    await startServer({ RATE_LIMIT_MAX: '1' });
    expect((await get('/health')).status).toBe(200);
    expect((await get('/health')).status).toBe(200);
    expect((await get(MAP_PATH)).status).toBe(200);
    expect((await get(MAP_PATH)).status).toBe(429);
  });

  it('honours RATE_LIMIT_FAIL_MESSAGE', async () => {
    await startServer({ RATE_LIMIT_MAX: '1', RATE_LIMIT_FAIL_MESSAGE: 'easy there' });
    await get(MAP_PATH);
    const res = await get(MAP_PATH);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('easy there');
  });

  it('is disabled when RATE_LIMIT_MAX is missing or invalid', async () => {
    await startServer({ RATE_LIMIT_MAX: 'lots' });
    for (let i = 0; i < 5; i++) {
      expect((await get(MAP_PATH)).status).toBe(200);
    }
  });

  it('resets the budget when the window elapses', () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
      expect(limiter.hit('ip').allowed).toBe(true);
      expect(limiter.hit('ip').allowed).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(limiter.hit('ip').allowed).toBe(true);
      limiter.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
