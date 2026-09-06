import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import osmsm, { closeBrowser, configureCache, getCache } from '../src/lib.js';
import server from '../src/server.js';

// Integration tests for the render cache through the library and the sample
// server. Like render.test.js they launch the headless browser and serve tiles
// from a local counting HTTP server, so a cache hit is observable as "no new
// tile requests".

const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let tileServer;
let tileserverUrl;
let tileRequests = 0;
let baseUrl;

beforeAll(async () => {
  tileServer = http.createServer((req, res) => {
    tileRequests++;
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(TILE_PNG);
  });
  await new Promise((resolve) => tileServer.listen(0, resolve));
  tileserverUrl = `http://localhost:${tileServer.address().port}/{z}/{x}/{y}.png`;

  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  configureCache(null);
  await closeBrowser();
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => tileServer.close(resolve));
});

beforeEach(() => {
  configureCache({ max: 10, ttl: 60 });
  tileRequests = 0;
});

const POINT = '{"type":"Point","coordinates":[-105.01621,39.57422]}';

// Node's fetch adds `Cache-Control: no-cache` whenever a conditional header is
// set, which (correctly) disables express' freshness check, so conditional
// requests go through the plain http client.
function conditionalGet(url, etag) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { 'If-None-Match': etag } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

describe('library render cache', () => {
  it('is disabled by default', () => {
    configureCache(null);
    expect(getCache()).toBeNull();
    configureCache({ max: 0 });
    expect(getCache()).toBeNull();
  });

  it('serves the second identical render from the cache', async () => {
    const first = await osmsm({ geojson: POINT, tileserverUrl });
    expect(tileRequests).toBeGreaterThan(0);
    expect(getCache().size).toBe(1);

    tileRequests = 0;
    const second = await osmsm({ geojson: POINT, tileserverUrl, timeout: 12345 });
    expect(tileRequests).toBe(0);
    expect(second.equals(first)).toBe(true);
  });

  it('renders again when a render-affecting option differs', async () => {
    await osmsm({ geojson: POINT, tileserverUrl });
    tileRequests = 0;
    await osmsm({ geojson: POINT, tileserverUrl, width: 320, height: 240 });
    expect(tileRequests).toBeGreaterThan(0);
    expect(getCache().size).toBe(2);
  });

  it('does not cache renderToHtml output', async () => {
    await osmsm({ geojson: POINT, tileserverUrl, renderToHtml: true });
    expect(getCache().size).toBe(0);
  });
});

describe('server render cache', () => {
  const url = () => `${baseUrl}/?geojson=${encodeURIComponent(POINT)}&tileserverUrl=${encodeURIComponent(tileserverUrl)}`;

  it('sets caching headers and reports hits and misses', async () => {
    const miss = await fetch(url());
    expect(miss.status).toBe(200);
    expect(miss.headers.get('content-type')).toContain('image/png');
    expect(miss.headers.get('x-cache')).toBe('MISS');
    expect(miss.headers.get('cache-control')).toBe('public, max-age=60');
    const etag = miss.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const body = Buffer.from(await miss.arrayBuffer());

    tileRequests = 0;
    const hit = await fetch(url());
    expect(hit.status).toBe(200);
    expect(hit.headers.get('x-cache')).toBe('HIT');
    expect(hit.headers.get('etag')).toBe(etag);
    expect(Buffer.from(await hit.arrayBuffer()).equals(body)).toBe(true);
    expect(tileRequests).toBe(0);

    expect(await conditionalGet(url(), etag)).toBe(304);
    expect(await conditionalGet(url(), '"stale"')).toBe(200);
    expect(tileRequests).toBe(0);
  });

  it('sends no caching headers when the cache is disabled', async () => {
    configureCache(null);
    const res = await fetch(url());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBeNull();
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('cache-control')).toBeNull();
  });

  it('does not cache the /dynamic html endpoint', async () => {
    const res = await fetch(`${baseUrl}/dynamic?geojson=${encodeURIComponent(POINT)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-cache')).toBeNull();
    expect(res.headers.get('etag')).toBeNull();
    expect(getCache().size).toBe(0);
  });
});
