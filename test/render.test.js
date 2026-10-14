import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import zlib from 'zlib';
import { Worker } from 'worker_threads';
import { createRequire } from 'module';
import puppeteer from 'puppeteer';
import osmsm, { closeBrowser, browserStats } from '../src/lib.js';

// Integration tests that actually launch the headless browser and render an
// image. To stay hermetic (no network flakiness) we serve every map tile from
// a tiny local HTTP server that returns a valid 1x1 PNG for any request.

const TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const require = createRequire(import.meta.url);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(buf) {
  // PNG layout: 8-byte signature, then the IHDR chunk whose width/height are
  // 32-bit big-endian integers at byte offsets 16 and 20.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// A maplibre style with a single solid background layer and no sources: the
// vector renderer paints the whole canvas red without any tile request.
const RED_STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ff0000' } }],
});

// Decode an 8-bit truecolor (RGB/RGBA, non-interlaced) PNG into raw RGBA.
function pngPixels(buf) {
  const { width, height } = pngDimensions(buf);
  const channels = buf[25] === 6 ? 4 : 3;
  const idat = [];
  for (let pos = 8; pos < buf.length;) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (line[x] + pred) & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

// Fraction of pixels close to the given rgb colour.
function colorFraction(png, [r, g, b], tolerance = 8) {
  const { data, channels } = pngPixels(png);
  let hits = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (Math.abs(data[i] - r) <= tolerance && Math.abs(data[i + 1] - g) <= tolerance && Math.abs(data[i + 2] - b) <= tolerance) hits++;
  }
  return hits / (data.length / channels);
}

// Busy-loop workers that starve the renderer of CPU like a loaded host.
function startCpuHogs(n) {
  const workers = Array.from({ length: n }, () => new Worker('for (;;) {}', { eval: true }));
  return () => Promise.all(workers.map((w) => w.terminate()));
}

let server;
let tileserverUrl;
let vectorserverUrl;
let slowVectorserverUrl;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url.endsWith('/slow-style.json')) {
      // the red background plus an (invisible) raster source whose tiles
      // take a while, so the style is not loaded() for the first frames
      const { port } = server.address();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({
        version: 8,
        sources: { slow: { type: 'raster', tiles: [`http://localhost:${port}/slow/{z}/{x}/{y}.png`], tileSize: 256 } },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#ff0000' } },
          { id: 'slow', type: 'raster', source: 'slow', paint: { 'raster-opacity': 0 } },
        ],
      }));
    }
    if (req.url.startsWith('/slow/')) {
      return setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
        res.end(TILE_PNG);
      }, 150);
    }
    if (req.url.endsWith('/style.json')) {
      // maplibre fetches the style with CORS from the page's opaque origin
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      return res.end(RED_STYLE);
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(TILE_PNG);
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  tileserverUrl = `http://localhost:${port}/{z}/{x}/{y}.png`;
  vectorserverUrl = `http://localhost:${port}/style.json`;
  slowVectorserverUrl = `http://localhost:${port}/slow-style.json`;
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

  it('never returns a map without its vector background under load', async () => {
    // Regression test for 6.0.1: with `fullPage: true` chromium temporarily
    // resized the page during the capture, maplibre cleared its canvas on the
    // resize and a loaded host could capture it before the redraw, giving the
    // light-blue leaflet container with only the overlays on it.
    const stopHogs = startCpuHogs(os.cpus().length * 2);
    try {
      const lines = [LINE_A, LINE_B];
      const renders = Array.from({ length: 24 }, (_, i) =>
        osmsm({ geojson: lines[i % 2], vectorserverUrl, width: 300, height: 200, arrows: true, maxZoom: 14, isolated: i % 3 === 0 })
      );
      const images = await Promise.all(renders);
      const redFractions = images.map((img) => colorFraction(img, [255, 0, 0]));
      expect(redFractions.filter((f) => f < 0.5)).toEqual([]);
    } finally {
      await stopHogs();
    }
  }, 120000);

  it('drops a page whose render failed', async () => {
    const before = browserStats().idlePages;
    await expect(osmsm({ geojson: '{not json', tileserverUrl, width: 321, height: 99, timeout: 5000 })).rejects.toThrow();
    expect(browserStats().idlePages).toBe(before);
    expect(browserStats().busyPages).toBe(0);
  });
});

describe('maplibre paint hook', () => {
  // src/template.html wraps maplibre's `Map.painter.render(style, options)`
  // and skips the paint while `!style.loaded()`, so a render paints its
  // WebGL frame once (every tile loaded) instead of once per batch of
  // tiles (-30% gpu-process CPU per render with software WebGL, see
  // CHANGELOG 6.1.0). `painter.render` is NOT public maplibre API: a
  // maplibre-gl upgrade can rename `painter`/`render`, change its
  // arguments, or change when `style.loaded()` flips, and the hook would
  // silently paint every frame again, throw at page load, or never paint.
  // That is why package.json pins `maplibre-gl` to an exact version and
  // these tests fail on purpose when it changes: after bumping maplibre-gl,
  // check the hook against the new `src/ui/map.ts` `_render()`, make sure
  // the test below still passes and the CPU saving still holds, then
  // update TESTED_MAPLIBRE_GL.
  const TESTED_MAPLIBRE_GL = '5.24.0';
  const DENVER_LINE = '{"type":"LineString","coordinates":[[-105.02,39.57],[-104.98,39.60]]}';
  const BARCELONA_LINE = '{"type":"LineString","coordinates":[[2.1,41.3],[2.2,41.4]]}';

  it('runs against the maplibre-gl version the hook was written for', () => {
    expect(require('maplibre-gl/package.json').version).toBe(TESTED_MAPLIBRE_GL);
    const pkg = require('../package.json');
    expect(pkg.dependencies['maplibre-gl']).toBe(TESTED_MAPLIBRE_GL);
    expect(pkg.dependencies['@maplibre/maplibre-gl-leaflet']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('skips the paints before the style is loaded and paints the loaded frame', async () => {
    const html = await osmsm({ geojson: DENVER_LINE, vectorserverUrl: slowVectorserverUrl, width: 300, height: 200, maxZoom: 14, renderToHtml: true });
    const browser = await puppeteer.launch({
      headless: 'shell',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.setViewport({ width: 300, height: 200 });
      await page.setContent(html);
      const waitRendered = () => page.waitForFunction(() => window.mapRendered === true || !!window.mapError, { timeout: 30000 });
      const state = () => page.evaluate(() => ({
        error: window.mapError,
        hooked: typeof window.backgroundLayer.painter.render === 'function',
        paints: { ...window.osmsmPaints },
      }));

      await waitRendered();
      const fresh = await state();
      expect(pageErrors).toEqual([]);
      expect(fresh.error).toBeNull();
      expect(fresh.hooked).toBe(true);
      expect(fresh.paints.skipped).toBeGreaterThan(0);
      expect(fresh.paints.done).toBeGreaterThan(0);

      // reused page (`window.renderMap`), another area so its tiles are slow again
      await page.evaluate((params) => window.renderMap(params), { geojson: BARCELONA_LINE, center: '', zoom: '', attribution: 'test', arrows: false });
      await waitRendered();
      const reused = await state();
      expect(reused.error).toBeNull();
      expect(reused.paints.skipped).toBeGreaterThan(fresh.paints.skipped);
      expect(reused.paints.done).toBeGreaterThan(fresh.paints.done);

      const png = await page.screenshot({ type: 'png', captureBeyondViewport: false });
      expect(colorFraction(png, [255, 0, 0])).toBeGreaterThan(0.5);
    } finally {
      await browser.close();
    }
  }, 60000);
});
