import { createHash } from "crypto";
import { mkdir, readdir, readFile, writeFile, stat, unlink } from "fs/promises";
import path from "path";

// Options that change the rendered image. Anything else (timeout,
// haltOnConsoleError, renderToHtml, unknown params...) is ignored so two
// requests for the same picture share a cache entry.
const KEY_OPTIONS = [
  "geojson",
  "geojsonfile",
  "height",
  "width",
  "center",
  "zoom",
  "maxZoom",
  "tileserverUrl",
  "vectorserverUrl",
  "vectorserverToken",
  "vectorserverAttribution",
  "attribution",
  "imagemin",
  "oxipng",
  "arrows",
  "scale",
  "markerIconOptions",
  "style",
  "type",
  "quality",
];

function stableStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

// Stable hash of the render-affecting options. Expects options already
// normalized with the library defaults so equivalent requests collide.
export function cacheKey(options) {
  const picked = {};
  for (const k of KEY_OPTIONS) {
    if (options[k] !== undefined) picked[k] = options[k];
  }
  return createHash("sha256").update(stableStringify(picked)).digest("hex");
}

const FILE_EXT = ".bin";

// In-memory LRU (bounded by `max` entries) with a TTL in seconds, optionally
// backed by a directory so entries survive restarts and can be shared between
// processes. Disk entries are expired lazily (checked on read via mtime).
export class RenderCache {
  constructor({ max = 100, ttl = 3600, dir } = {}) {
    this.max = Number(max);
    this.ttl = Number(ttl);
    this.dir = dir || null;
    this.entries = new Map();
    this.ready = this.dir ? mkdir(this.dir, { recursive: true }) : Promise.resolve();
  }

  get size() {
    return this.entries.size;
  }

  filePath(key) {
    return path.join(this.dir, key + FILE_EXT);
  }

  expired(storedAt) {
    return storedAt + this.ttl * 1000 <= Date.now();
  }

  getMemory(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.expired(entry.storedAt)) {
      this.entries.delete(key);
      return undefined;
    }
    // refresh recency
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  setMemory(key, value, storedAt = Date.now()) {
    if (this.max <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt });
    while (this.entries.size > this.max) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  async getDisk(key) {
    const file = this.filePath(key);
    let info;
    try {
      info = await stat(file);
    } catch {
      return undefined;
    }
    if (this.expired(info.mtimeMs)) {
      await unlink(file).catch(() => {});
      return undefined;
    }
    try {
      return await readFile(file);
    } catch {
      return undefined;
    }
  }

  async has(key) {
    return (await this.get(key)) !== undefined;
  }

  async get(key) {
    const hit = this.getMemory(key);
    if (hit !== undefined || !this.dir) return hit;
    await this.ready;
    const value = await this.getDisk(key);
    if (value !== undefined) this.setMemory(key, value);
    return value;
  }

  async set(key, value) {
    this.setMemory(key, value);
    if (this.dir) {
      await this.ready;
      await writeFile(this.filePath(key), value);
    }
  }

  async delete(key) {
    this.entries.delete(key);
    if (this.dir) {
      await this.ready;
      await unlink(this.filePath(key)).catch(() => {});
    }
  }

  async clear() {
    this.entries.clear();
    if (this.dir) {
      await this.ready;
      const files = await readdir(this.dir).catch(() => []);
      await Promise.all(
        files
          .filter((f) => f.endsWith(FILE_EXT))
          .map((f) => unlink(path.join(this.dir, f)).catch(() => {}))
      );
    }
  }
}
