import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, rm, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { cacheKey } from '../src/lib.js';
import { RenderCache } from '../src/cache.js';

// Unit tests for the render cache: key derivation and the LRU/TTL store with
// its optional directory persistence. No browser needed.

const POINT = '{"type":"Point","coordinates":[-105.01621,39.57422]}';

describe('cacheKey', () => {
  it('is a stable hex digest independent of option order', () => {
    const a = cacheKey({ geojson: POINT, width: 300, height: 200 });
    const b = cacheKey({ height: 200, width: 300, geojson: POINT });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('treats explicit defaults and equivalent representations alike', () => {
    expect(cacheKey({})).toBe(cacheKey({ width: 800, height: '600', type: 'png', maxZoom: '17' }));
    expect(cacheKey({ geojson: { type: 'Point', coordinates: [1, 2] } })).toBe(
      cacheKey({ geojson: '{"type":"Point","coordinates":[1,2]}' })
    );
  });

  it('ignores options that do not change the image', () => {
    const base = cacheKey({ geojson: POINT });
    expect(cacheKey({ geojson: POINT, timeout: 5000 })).toBe(base);
    expect(cacheKey({ geojson: POINT, haltOnConsoleError: true })).toBe(base);
    expect(cacheKey({ geojson: POINT, renderToHtml: true })).toBe(base);
    expect(cacheKey({ geojson: POINT, unknownParam: 'x' })).toBe(base);
  });

  it('changes when a render-affecting option changes', () => {
    const base = cacheKey({ geojson: POINT });
    expect(cacheKey({ geojson: POINT, width: 320 })).not.toBe(base);
    expect(cacheKey({ geojson: POINT, type: 'jpeg' })).not.toBe(base);
    expect(cacheKey({ geojson: POINT, arrows: true })).not.toBe(base);
    expect(cacheKey({ geojson: '{"type":"Point","coordinates":[0,0]}' })).not.toBe(base);
  });
});

describe('RenderCache (memory)', () => {
  afterEach(() => vi.useRealTimers());

  it('stores and returns buffers', async () => {
    const cache = new RenderCache({ max: 10, ttl: 60 });
    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.has('a')).toBe(false);
    await cache.set('a', Buffer.from('img-a'));
    expect((await cache.get('a')).toString()).toBe('img-a');
    expect(await cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
    await cache.delete('a');
    expect(await cache.get('a')).toBeUndefined();
  });

  it('evicts the least recently used entry beyond max', async () => {
    const cache = new RenderCache({ max: 2, ttl: 60 });
    await cache.set('a', Buffer.from('a'));
    await cache.set('b', Buffer.from('b'));
    await cache.get('a'); // a is now more recent than b
    await cache.set('c', Buffer.from('c'));
    expect(cache.size).toBe(2);
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBeDefined();
    expect(await cache.get('c')).toBeDefined();
  });

  it('expires entries after ttl seconds', async () => {
    vi.useFakeTimers();
    const cache = new RenderCache({ max: 10, ttl: 10 });
    await cache.set('a', Buffer.from('a'));
    vi.advanceTimersByTime(9_000);
    expect(await cache.get('a')).toBeDefined();
    vi.advanceTimersByTime(2_000);
    expect(await cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('keeps nothing in memory when max is 0', async () => {
    const cache = new RenderCache({ max: 0, ttl: 60 });
    await cache.set('a', Buffer.from('a'));
    expect(cache.size).toBe(0);
    expect(await cache.get('a')).toBeUndefined();
  });

  it('clear drops every entry', async () => {
    const cache = new RenderCache({ max: 10, ttl: 60 });
    await cache.set('a', Buffer.from('a'));
    await cache.set('b', Buffer.from('b'));
    await cache.clear();
    expect(cache.size).toBe(0);
    expect(await cache.get('a')).toBeUndefined();
  });
});

describe('RenderCache (directory)', () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('persists entries on disk so a fresh instance can read them', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'osmsm-cache-'));
    const first = new RenderCache({ max: 10, ttl: 60, dir });
    await first.set('a', Buffer.from('img-a'));
    expect(await readdir(dir)).toEqual(['a.bin']);

    const second = new RenderCache({ max: 10, ttl: 60, dir });
    expect(second.size).toBe(0);
    expect((await second.get('a')).toString()).toBe('img-a');
    // read from disk gets promoted to memory
    expect(second.size).toBe(1);
  });

  it('works disk-only when max is 0', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'osmsm-cache-'));
    const cache = new RenderCache({ max: 0, ttl: 60, dir });
    await cache.set('a', Buffer.from('img-a'));
    expect(cache.size).toBe(0);
    expect((await cache.get('a')).toString()).toBe('img-a');
  });

  it('expires disk entries by file age and removes them', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'osmsm-cache-'));
    const cache = new RenderCache({ max: 0, ttl: 60, dir });
    await cache.set('a', Buffer.from('img-a'));
    const old = new Date(Date.now() - 120_000);
    await utimes(path.join(dir, 'a.bin'), old, old);
    expect(await cache.get('a')).toBeUndefined();
    expect(await readdir(dir)).toEqual([]);
  });

  it('creates the directory and clear only removes cache files', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'osmsm-cache-'));
    const nested = path.join(dir, 'nested', 'cache');
    const cache = new RenderCache({ max: 10, ttl: 60, dir: nested });
    await cache.set('a', Buffer.from('a'));
    await cache.delete('a');
    expect(await readdir(nested)).toEqual([]);
    await cache.set('b', Buffer.from('b'));
    await cache.clear();
    expect(await readdir(nested)).toEqual([]);
    expect(await cache.get('b')).toBeUndefined();
  });
});
