import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import osmsm, { closeBrowser } from '../src/lib.js';

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
      await osmsm({ geojson: POINT, tileserverUrl: url });
      const firstRender = hits;
      expect(firstRender).toBeGreaterThan(0);
      await osmsm({ geojson: POINT, tileserverUrl: url });
      expect(hits).toBe(firstRender);
    } finally {
      await new Promise((resolve) => cachingServer.close(resolve));
    }
  });

  it('renders without any geojson (empty map)', async () => {
    const img = await osmsm({ tileserverUrl });
    expect(Buffer.isBuffer(img)).toBe(true);
    expect(img.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});
