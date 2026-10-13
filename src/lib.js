import { readFileSync, existsSync } from 'fs';
import http from 'http';
import https from "https";
import handlebars from 'handlebars';
import { spawn } from "child_process";
import { fileURLToPath } from 'url';

let chrome = { args: [] };
let puppeteer;

// Whether the loaded puppeteer ships its own browser (full `puppeteer`) or not
// (`puppeteer-core`, which needs an explicit executablePath to a system browser).
let usingBundledBrowser = false;

async function loadPuppeteer() {
  if (puppeteer) return;
  if (process.env.AWS_LAMBDA_FUNCTION_VERSION) {
    chrome = (await import("chrome-aws-lambda")).default;
    puppeteer = (await import("puppeteer-core")).default;
  } else {
    try {
      puppeteer = (await import("puppeteer")).default;
      usingBundledBrowser = true;
    } catch {
      puppeteer = (await import("puppeteer-core")).default;
    }
  }
}

// Path to the browser that the bundled `puppeteer` package downloads. Returns
// null if puppeteer can't tell us (older API or no browser configured) so the
// caller can fall back to a system browser. `executablePath()` returns a
// Promise since puppeteer v25.
async function bundledBrowserPath() {
  // chrome-headless-shell (the lightweight headless-only build) when it is
  // installed, else the regular chrome build.
  for (const which of [{ headless: 'shell' }, undefined]) {
    try {
      const found = await puppeteer.executablePath(which);
      if (found && existsSync(found)) return found;
    } catch {
      // fall through to the next candidate
    }
  }
  return null;
}

// Best-effort lookup of a browser executable when using puppeteer-core.
// Honors PUPPETEER_EXECUTABLE_PATH first, then probes common system paths.
// Throws a helpful error (listing every path tried) when nothing is found.
function findSystemBrowser() {
  // linux and others
  let systemBrowserCandidates = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
    "/snap/bin/chromium",
  ]
  if (process.platform === "darwin") {
    systemBrowserCandidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env["PROGRAMFILES"],
      process.env["PROGRAMFILES(X86)"],
      process.env["LOCALAPPDATA"],
    ].filter(Boolean);
    const relatives = [
      "Google\\Chrome\\Application\\chrome.exe",
      "Chromium\\Application\\chrome.exe",
      "Microsoft\\Edge\\Application\\msedge.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    ];
    systemBrowserCandidates = roots.flatMap((root) => relatives.map((rel) => `${root}\\${rel}`));
  }

  const tried = [];
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath) {
    tried.push(envPath);
    if (existsSync(envPath)) return envPath;
  }
  for (const candidate of systemBrowserCandidates) {
    tried.push(candidate);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not find a Chrome/Chromium browser to render the map. " +
    "Set the PUPPETEER_EXECUTABLE_PATH environment variable to your browser " +
    "executable.\nPaths tried (in order):\n" +
    tried.map((p) => "  - " + p).join("\n")
  );
}

// Resolve the oxipng executable, returning bare "oxipng" (PATH lookup) as a
// last resort so spawn surfaces ENOENT when it is genuinely missing.
// Honors OXIPNG_PATH, then common cargo/system install dirs, then falls back to PATH.
function resolveOxipng() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const oxipngCandidates = [
    home && `${home}/.cargo/bin/oxipng`,
    "/root/.cargo/bin/oxipng",
    "/usr/local/bin/oxipng",
    "/usr/bin/oxipng",
  ].filter(Boolean);

  if (process.env.OXIPNG_PATH) return process.env.OXIPNG_PATH;
  for (const candidate of oxipngCandidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "oxipng";
}

function getDep(nodeModulesFile, binary = false) {
  const abspath = fileURLToPath(import.meta.resolve(nodeModulesFile));
  if (binary) {
    return Buffer.from(readFileSync(abspath), 'binary').toString('base64');
  }
  else {
    return readFileSync(abspath, 'utf8');
  }
}

const files = {
  leafletjs: getDep('leaflet/dist/leaflet.js'),
  leafletcss: getDep('leaflet/dist/leaflet.css'),
  leafletpolylinedecorator: getDep('leaflet-polylinedecorator/dist/leaflet.polylineDecorator.js'),
  mapboxjs: getDep('maplibre-gl/dist/maplibre-gl.js'),
  mapboxcss: getDep('maplibre-gl/dist/maplibre-gl.css'),
  leafletmapboxjs: getDep('@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js'),
  markericonpng: getDep('leaflet/dist/images/marker-icon.png', true),
}
const templatestr = getDep('./template.html');
const template = handlebars.compile(templatestr);


function replacefiles(str) {
  const ff = Object.entries(files)
  let res = str
  ff.reverse()
  ff.forEach(([k, v]) => res = res.replace(`//${k}//`, v))
  return res
}

// Idle pages kept for reuse (each one holds a parsed leaflet/maplibre and the
// background layer's in-memory tiles) and renders after which a page is
// recycled anyway, to bound the memory of a long-lived server. Overridable
// with configureBrowser() or OSMSM_MAX_IDLE_PAGES / OSMSM_MAX_RENDERS_PER_PAGE.
const DEFAULT_MAX_IDLE_PAGES = 4;
const DEFAULT_MAX_RENDERS_PER_PAGE = 100;

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

class Browser {
  /// browser singleton
  constructor() {
    this.browser = null;
    this.config = {
      singleProcess: false,
      isolated: false,
      maxIdlePages: positiveInt(process.env.OSMSM_MAX_IDLE_PAGES, DEFAULT_MAX_IDLE_PAGES),
      maxRendersPerPage: positiveInt(process.env.OSMSM_MAX_RENDERS_PER_PAGE, DEFAULT_MAX_RENDERS_PER_PAGE),
    };
  }
  async launch() {
    await loadPuppeteer();
    // chrome.executablePath is set on Lambda/Vercel.
    let executablePath = await chrome.executablePath;
    if (!executablePath) {
      // Prefer the bundled puppeteer browser when it's actually installed;
      // otherwise (puppeteer-core, or a missing/version-mismatched bundled
      // browser) locate a system browser. PUPPETEER_EXECUTABLE_PATH always wins.
      const bundled = usingBundledBrowser && !process.env.PUPPETEER_EXECUTABLE_PATH
        ? await bundledBrowserPath()
        : null;
      executablePath = bundled && existsSync(bundled) ? bundled : findSystemBrowser();
    }
    // Log to stderr so it doesn't corrupt the image binary piped to stdout.
    console.error(`Launching chromium from: ${executablePath || "(puppeteer default)"}`);
    return puppeteer.launch({
      args: [
        ...chrome.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        // The map page is loaded with page.setContent(), i.e. from an opaque
        // about:blank origin. Chromium partitions its HTTP cache by top-frame
        // origin and never caches for opaque ones, so by default every render
        // re-downloaded every tile, glyph and sprite. Disabling the partitioning
        // lets the browser's own cache (honouring the tile server's Cache-Control)
        // serve repeated resources for the whole life of the browser singleton.
        "--disable-features=SplitCacheByNetworkIsolationKey",
        // One-shot renders (CLI) don't need chromium's process isolation and
        // render ~40% faster without it. Not for long-lived use: one crashed
        // render would take the shared browser down.
        ...(this.config.singleProcess ? ["--single-process"] : []),
      ],
      defaultViewport: chrome.defaultViewport,
      executablePath,
      // The headless-only chrome-headless-shell build renders ~20% faster
      // than the full browser in headless mode; with a full chrome binary
      // puppeteer falls back to its regular headless mode.
      headless: 'shell',
      acceptInsecureCerts: true,
    });
  }
  async getBrowser() {
    if (!this.browser || !this.browser.connected) {
      // Store the in-flight launch promise so concurrent callers await the
      // same launch instead of erroring or starting a second browser.
      if (!this.launching) {
        this.launching = this.launch()
          .catch((e) => {
            console.log(e)
            console.log('Error opening browser')
            console.log(JSON.stringify(e, undefined, 2))
            return null;
          })
          .finally(() => { this.launching = null; });
      }
      this.browser = await this.launching;
    }
    return this.browser
  }
  async getPage() {
    const browser = await this.getBrowser()
    return browser.newPage()
  }
  async close() {
    await pool.closeAll();
    if (this.browser && this.browser.connected) {
      await this.browser.close();
    }
    this.browser = null;
  }
}
const browser = new Browser();

function closePage(page) {
  return page.close().catch((e) => console.log("Error closing page: " + e));
}

// Pages that already parsed the map libraries and loaded the background
// layer, keyed by everything the page's html depends on (see pageKey): a
// render that finds an idle page for its key only swaps the overlays and the
// view (renderMap in template.html) instead of building a new page.
class PagePool {
  constructor() {
    this.idle = [];
    this.busy = new Set();
  }
  take(key) {
    this.idle = this.idle.filter((e) => !e.dead && !e.page.isClosed());
    const i = this.idle.findIndex((e) => e.key === key);
    if (i < 0) return null;
    const [entry] = this.idle.splice(i, 1);
    this.busy.add(entry);
    return entry;
  }
  add(page, key) {
    const entry = { page, key, renders: 0, dead: false, onError: null, haltOnConsoleError: false };
    const fail = (err) => entry.onError && entry.onError(err instanceof Error ? err : new Error(String(err)));
    page.on('error', (err) => { entry.dead = true; fail(err); });
    page.on('pageerror', (err) => { entry.dead = true; fail(err); });
    page.on('console', (msg) => {
      if (entry.haltOnConsoleError && msg.type() === "error") {
        fail(new Error(`Console error while rendering the map: ${msg.text()}`));
      }
    });
    this.busy.add(entry);
    return entry;
  }
  async release(entry, keep) {
    this.busy.delete(entry);
    entry.onError = null;
    if (keep && !entry.dead && !entry.page.isClosed() && entry.renders < browser.config.maxRendersPerPage) {
      this.idle.push(entry);
      while (this.idle.length > browser.config.maxIdlePages) {
        await closePage(this.idle.shift().page);
      }
    } else {
      await closePage(entry.page);
    }
  }
  async closeAll() {
    const all = [...this.idle, ...this.busy];
    this.idle = [];
    this.busy.clear();
    await Promise.all(all.map((e) => closePage(e.page)));
  }
}
const pool = new PagePool();

function pageKey(options) {
  return JSON.stringify([
    options.width,
    options.height,
    options.maxZoom,
    options.vectorserverUrl,
    options.vectorserverToken,
    options.vectorserverAttribution,
    options.vectorserverUrl ? '' : options.tileserverUrl,
  ]);
}

export async function closeBrowser() {
  await browser.close();
}

// Process-wide settings for the shared browser. `singleProcess` (chromium
// --single-process, only for one-shot use) applies to the next launch;
// `isolated` is the default for the render option of the same name;
// `maxIdlePages` / `maxRendersPerPage` bound the warm page pool.
export function configureBrowser({ singleProcess, isolated, maxIdlePages, maxRendersPerPage } = {}) {
  if (singleProcess !== undefined) browser.config.singleProcess = !!singleProcess;
  if (isolated !== undefined) browser.config.isolated = !!isolated;
  if (maxIdlePages !== undefined) browser.config.maxIdlePages = positiveInt(maxIdlePages, browser.config.maxIdlePages);
  if (maxRendersPerPage !== undefined) browser.config.maxRendersPerPage = positiveInt(maxRendersPerPage, browser.config.maxRendersPerPage);
}

// Number of warm pages kept for reuse and currently rendering.
export function browserStats() {
  return { idlePages: pool.idle.length, busyPages: pool.busy.size };
}

// Eagerly launch chromium (e.g. at server startup) so the launch happens and
// is logged before the first request, instead of lazily on first render.
export async function warmupBrowser() {
  await browser.getBrowser();
}


function httpGet(url) {
  // from https://stackoverflow.com/a/41471647/912450
  const httpx = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    let req = httpx.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Error ${res.statusCode} trying to get geojson file from ${url}`));
      }
      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => resolve(rawData) );
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

process.on("warning", (e) => console.warn(e.stack));


const IMAGE_TYPES = ['png', 'jpeg', 'webp'];

function normalizeImageType(type) {
  if (type === undefined || type === null || type === '') return 'png';
  const t = String(type).toLowerCase() === 'jpg' ? 'jpeg' : String(type).toLowerCase();
  if (!IMAGE_TYPES.includes(t)) {
    throw new Error(`'type' can only be one of ${IMAGE_TYPES.map(x => `'${x}'`).join(', ')} (got '${type}')`);
  }
  return t;
}

function normalizeQuality(quality) {
  if (quality === undefined || quality === null || quality === '') return 100;
  const q = Number(quality);
  if (!Number.isInteger(q) || q < 0 || q > 100) {
    throw new Error(`'quality' must be an integer between 0 and 100 (got '${quality}')`);
  }
  return q;
}

// Options the CLI/server pass as JSON strings and the library as objects.
function parseJsonOption(name, value) {
  if (!value) return false;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`'${name}' must be a JSON string (got '${value}')`);
  }
}

export default function(options) {
  return new Promise(function(resolve, reject) {
    // TODO: validate options to avoid template injection
    options = options || {};
    options.geojson = (options.geojson && (typeof options.geojson === 'string' ? options.geojson : JSON.stringify(options.geojson))) || '';
    options.geojsonfile = options.geojsonfile || '';
    options.height = options.height || 600;
    options.width = options.width || 800;
    options.center = options.center || '';
    options.zoom = options.zoom || '';
    options.maxZoom = options.maxZoom || 17;
    options.tileserverUrl = options.tileserverUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    options.vectorserverUrl = options.vectorserverUrl || '';
    options.vectorserverToken = options.vectorserverToken || '';
    options.vectorserverAttribution =
      options.vectorserverAttribution === undefined
        ? true
        : options.vectorserverAttribution !== false && options.vectorserverAttribution !== 'false';
    options.attribution = options.attribution || (options.vectorserverUrl ? 'osm-static-maps' : 'osm-static-maps / © OpenStreetMap contributors');
    options.type = normalizeImageType(options.type);
    options.quality = normalizeQuality(options.quality);
    options.imagemin = options.imagemin || false;
    options.oxipng = options.oxipng || false;
    options.arrows = options.arrows || false;
    options.scale = (options.scale && (typeof options.scale === 'string' ? options.scale : JSON.stringify(options.scale))) || false;
    options.markerIconOptions = (options.markerIconOptions && (typeof options.markerIconOptions === 'string' ? options.markerIconOptions : JSON.stringify(options.markerIconOptions))) || false;
    options.style = (options.style && (typeof options.style === 'string' ? options.style : JSON.stringify(options.style))) || false;
    options.timeout = options.timeout || 20000;
    options.haltOnConsoleError = !!options.haltOnConsoleError;
    options.isolated =
      options.isolated === undefined || options.isolated === null || options.isolated === ''
        ? browser.config.isolated
        : options.isolated !== false && options.isolated !== 'false';

    (async () => {

      if (options.geojsonfile) {
        if (options.geojson) {
          throw new Error(`Only one option allowed: 'geojsonfile' or 'geojson'`)
        }
        if (options.geojsonfile.startsWith("http://") || options.geojsonfile.startsWith("https://")) {
          options.geojson = await httpGet(options.geojsonfile)
        }
        else {
          options.geojson = readFileSync(
            options.geojsonfile == "-"
              ? process.stdin.fd
              : options.geojsonfile,
            "utf8"
          );
        }
      }

      // Everything renderMap() (template.html) needs for this render; the
      // rest of the options shape the page itself (see pageKey).
      const renderParams = {
        geojson: options.geojson,
        center: options.center,
        zoom: options.zoom,
        attribution: options.attribution,
        arrows: !!options.arrows,
        scale: parseJsonOption('scale', options.scale),
        markerIconOptions: parseJsonOption('markerIconOptions', options.markerIconOptions),
        style: parseJsonOption('style', options.style),
      };
      // Embedded in a <script>, so '<' must not be able to close it.
      const initialParams = JSON.stringify(renderParams).replace(/</g, '\\u003c');
      const html = replacefiles(template({ ...options, initialParams }));

      if (options.renderToHtml) {
        return resolve(html);
      }

      const key = pageKey(options);
      let entry = options.isolated ? null : pool.take(key);
      const reused = !!entry;
      if (!entry) {
        entry = pool.add(await browser.getPage(), key);
      }
      const page = entry.page;
      let rendered = false;
      try {
        entry.onError = reject;
        entry.haltOnConsoleError = options.haltOnConsoleError;
        entry.renders++;

        if (reused) {
          await page.evaluate((params) => window.renderMap(params), renderParams);
        } else {
          await page.setViewport({
            width: Number(options.width),
            height: Number(options.height)
          });
          await page.setContent(html);
        }
        await page.waitForFunction(
          () => window.mapRendered === true || !!window.mapError,
          { timeout: Number(options.timeout) }
        );
        const mapError = await page.evaluate(() => window.mapError);
        if (mapError) {
          throw new Error(`Error rendering the map: ${mapError}`);
        }

        let imageBinary = await page.screenshot({
          type: options.type,
          // png is lossless, so puppeteer rejects a quality value for it
          quality: options.type === 'png' ? undefined : options.quality,
          fullPage: true
        });
        rendered = true;

        // imagemin only ships lossless plugins for png/jpeg and oxipng only
        // handles png; webp (and jpeg for oxipng) is returned as rendered.
        const canImagemin = options.imagemin && ['png', 'jpeg'].includes(options.type);
        const canOxipng = options.oxipng && options.type === 'png';

        if (canImagemin) {
          let imagemin, imageminJpegtran, imageminOptipng;
          try {
            imagemin = (await import("imagemin")).default;
            imageminJpegtran = (await import("imagemin-jpegtran")).default;
            imageminOptipng = (await import("imagemin-optipng")).default;
          } catch (e) {
            reject(new Error(
              "The --imagemin option requires the optional 'imagemin', 'imagemin-jpegtran' " +
              "and 'imagemin-optipng' packages, which are not installed (their native " +
              "build may have failed). Install them manually or use --oxipng instead."
            ));
            return;
          }
          const plugins = []
          if (options.type === 'jpeg') {
            plugins.push(imageminJpegtran());
          } else {
            plugins.push(imageminOptipng());
          }
          (async () => {
            resolve(await imagemin.buffer(
              Buffer.from(imageBinary),
              {
                plugins,
              }
            ))
          })();
        } else {
          if (canOxipng) {
            const child = spawn(resolveOxipng(), ['-o0', '-s', '-']);
            child.stdin.on('error', function() {});
            child.stdin.write(imageBinary);
            child.stdin.end();
            let newimg = [];
            child.stdout.on('data', data => newimg.push(data));
            child.on('close', () => resolve(Buffer.concat(newimg)));
            child.on('error', e => {
              if (e && e.code === 'ENOENT') {
                reject(new Error(
                  "The --oxipng option requires the 'oxipng' binary, which could " +
                  "not be found. Install it (https://github.com/oxipng/oxipng) and " +
                  "make sure it is on your PATH, or set the OXIPNG_PATH environment " +
                  "variable to its location."
                ));
              } else {
                reject(e instanceof Error ? e : new Error(String(e)));
              }
            });
          } else {
            resolve(Buffer.from(imageBinary));
          }
        }

      }
      finally {
        // A page whose render failed or timed out may still be loading; only
        // a page that rendered is safe to hand to the next render.
        await pool.release(entry, rendered && !options.isolated);
      }

    })().catch(reject)
  });
};
