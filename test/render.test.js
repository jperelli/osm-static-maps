import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import osmsm, { closeBrowser, browserStats } from '../src/lib.js';

// Integration tests that actually launch the headless browser and render an
// image. To stay hermetic (no network flakiness) we serve every map tile from
// a tiny local HTTP server that returns a valid 1x1 PNG for any request.

const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(buf) {
  // PNG layout: 8-byte signature, then the IHDR chunk whose width/height are
  // 32-bit big-endian integers at byte offsets 16 and 20.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let server;
let tileserverUrl;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(TILE_PNG);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  tileserverUrl = `http://localhost:${port}/{z}/{x}/{y}.png`;
});

afterAll(async () => {
  await closeBrowser();
  await new Promise((resolve) => server.close(resolve));
});

const POINT = '{"type":"Point","coordinates":[-105.01621,39.57422]}';

describe('image rendering', () => {
  it('renders a geojson point to a non-empty PNG buffer', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl });
    expect(Buffer.isBuffer(img)).toBe(true);
    expect(img.length).toBeGreaterThan(0);
    expect(img.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('produces an image with the default 800x600 dimensions', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl });
    expect(pngDimensions(img)).toEqual({ width: 800, height: 600 });
  });

  it('honours custom width and height', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl, width: 320, height: 240 });
    expect(pngDimensions(img)).toEqual({ width: 320, height: 240 });
  });

  it('renders to JPEG when type is "jpeg"', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl, type: 'jpeg' });
    expect(Buffer.isBuffer(img)).toBe(true);
    expect(img.length).toBeGreaterThan(0);
    // JPEG files start with the SOI marker FF D8 FF
    expect(img[0]).toBe(0xff);
    expect(img[1]).toBe(0xd8);
    expect(img[2]).toBe(0xff);
  });

  it('renders to WebP when type is "webp"', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl, type: 'webp' });
    expect(Buffer.isBuffer(img)).toBe(true);
    expect(img.length).toBeGreaterThan(0);
    // WebP files are RIFF containers: "RIFF" <size> "WEBP"
    expect(img.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(img.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('accepts "jpg" as an alias of "jpeg"', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl, type: 'jpg' });
    expect(img[0]).toBe(0xff);
    expect(img[1]).toBe(0xd8);
  });

  it('lower quality produces a smaller jpeg and webp', async () => {
    for (const type of ['jpeg', 'webp']) {
      const hi = await osmsm({ geojson: POINT, tileserverUrl, type, quality: 100 });
      const lo = await osmsm({ geojson: POINT, tileserverUrl, type, quality: 10 });
      expect(lo.length).toBeLessThan(hi.length);
    }
  });

  it('accepts quality as a string (as sent by server query params)', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl, type: 'webp', quality: '50' });
    expect(img.subarray(8, 12).toString('ascii')).toBe('WEBP');
  });

  it('ignores quality for png (lossless)', async () => {
    const img = await osmsm({ geojson: POINT, tileserverUrl, type: 'png', quality: 10 });
    expect(img.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });

  it('rejects an unknown type', async () => {
    await expect(osmsm({ geojson: POINT, tileserverUrl, type: 'gif' })).rejects.toThrow(/'type'/);
  });

  it('rejects an out-of-range quality', async () => {
    await expect(osmsm({ geojson: POINT, tileserverUrl, type: 'webp', quality: 101 })).rejects.toThrow(/'quality'/);
    await expect(osmsm({ geojson: POINT, tileserverUrl, type: 'jpeg', quality: 'high' })).rejects.toThrow(/'quality'/);
  });

  it('reuses cached tiles across renders when the tile server allows it', async () => {
    let hits = 0;
    const cachingServer = http.createServer((req, res) => {
      hits++;
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
      res.end(TILE_PNG);
    });
    await new Promise((resolve) => cachingServer.listen(0, resolve));
    try {
      const url = `http://localhost:${cachingServer.address().port}/cached/{z}/{x}/{y}.png`;
      // isolated: a fresh page each time, so only chromium's HTTP cache can
      // avoid the second download (a reused page keeps the tiles in memory)
      await osmsm({ geojson: POINT, tileserverUrl: url, isolated: true });
      const firstRender = hits;
      expect(firstRender).toBeGreaterThan(0);
      await osmsm({ geojson: POINT, tileserverUrl: url, isolated: true });
      expect(hits).toBe(firstRender);
    } finally {
      await new Promise((resolve) => cachingServer.close(resolve));
    }
  });

  it('rejects a geojson that is not valid JSON instead of timing out', async () => {
    await expect(osmsm({ geojson: '{not json', tileserverUrl, timeout: 5000 })).rejects.toThrow(/Error rendering the map/);
  });

  it('renders without any geojson (empty map)', async () => {
    const img = await osmsm({ tileserverUrl });
    expect(Buffer.isBuffer(img)).toBe(true);
    expect(img.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});

describe('page reuse', () => {
  const LINE_A = '{"type":"LineString","coordinates":[[-105.02,39.57],[-105.01,39.58]]}';
  const LINE_B = '{"type":"LineString","coordinates":[[-105.03,39.56],[-105.00,39.59],[-105.02,39.60]]}';

  it('keeps one warm page per page key and reuses it', async () => {
    const before = browserStats().idlePages;
    const a = await osmsm({ geojson: LINE_A, tileserverUrl, width: 300, height: 200, arrows: true });
    const b = await osmsm({ geojson: LINE_B, tileserverUrl, width: 300, height: 200 });
    expect(browserStats().idlePages).toBe(before + 1);
    expect(a.equals(b)).toBe(false);
    expect(pngDimensions(b)).toEqual({ width: 300, height: 200 });

    await osmsm({ geojson: LINE_B, tileserverUrl, width: 310, height: 200 });
    expect(browserStats().idlePages).toBe(before + 2);
    expect(browserStats().busyPages).toBe(0);
  });

  it('renders the same image from a warm page as from a fresh one', async () => {
    const fresh = await osmsm({ geojson: LINE_A, tileserverUrl, width: 300, height: 200, isolated: true });
    await osmsm({ geojson: LINE_B, tileserverUrl, width: 300, height: 200 });
    const warm = await osmsm({ geojson: LINE_A, tileserverUrl, width: 300, height: 200 });
    expect(warm.equals(fresh)).toBe(true);
  });

  it('isolated renders do not keep a page', async () => {
    const before = browserStats().idlePages;
    await osmsm({ geojson: LINE_A, tileserverUrl, width: 123, height: 99, isolated: true });
    await osmsm({ geojson: LINE_A, tileserverUrl, width: 123, height: 99, isolated: 'true' });
    expect(browserStats().idlePages).toBe(before);
  });

  it('drops a page whose render failed', async () => {
    const before = browserStats().idlePages;
    await expect(osmsm({ geojson: '{not json', tileserverUrl, width: 321, height: 99, timeout: 5000 })).rejects.toThrow();
    expect(browserStats().idlePages).toBe(before);
    expect(browserStats().busyPages).toBe(0);
  });
});
