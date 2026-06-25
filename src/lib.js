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
  try {
    return await puppeteer.executablePath();
  } catch {
    return null;
  }
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

class Browser {
  /// browser singleton
  constructor() {
    this.browser = null;
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
      args: [...chrome.args, "--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: chrome.defaultViewport,
      executablePath,
      headless: true,
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
    if (this.browser && this.browser.connected) {
      await this.browser.close();
    }
    this.browser = null;
  }
}
const browser = new Browser();

export async function closeBrowser() {
  await browser.close();
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


// add network cache to cache tiles
const cache = {};
async function configCache(page) {
  await page.setRequestInterception(true);

  page.on('request', async (request) => {
      const url = request.url();
      if (cache[url] && cache[url].expires > Date.now()) {
          await request.respond(cache[url]);
          return;
      }
      request.continue();
  });
  
  page.on('response', async (response) => {
      const url = response.url();
      const headers = response.headers();
      const cacheControl = headers['cache-control'] || '';
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch && maxAgeMatch.length > 1 ? parseInt(maxAgeMatch[1], 10) : 0;
      if (maxAge) {
          if (cache[url] && cache[url].expires > Date.now()) return;
  
          let buffer;
          try {
              buffer = await response.buffer();
          } catch (error) {
              // some responses do not contain buffer and do not need to be catched
              return;
          }
  
          cache[url] = {
              status: response.status(),
              headers: response.headers(),
              body: buffer,
              expires: Date.now() + (maxAge * 1000),
          };
      }
  });
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
    options.imagemin = options.imagemin || false;
    options.oxipng = options.oxipng || false;
    options.arrows = options.arrows || false;
    options.scale = (options.scale && (typeof options.scale === 'string' ? options.scale : JSON.stringify(options.scale))) || false;
    options.markerIconOptions = (options.markerIconOptions && (typeof options.markerIconOptions === 'string' ? options.markerIconOptions : JSON.stringify(options.markerIconOptions))) || false;
    options.style = (options.style && (typeof options.style === 'string' ? options.style : JSON.stringify(options.style))) || false;
    options.timeout = options.timeout || 20000;
    options.haltOnConsoleError = !!options.haltOnConsoleError;

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

      const html = replacefiles(template(options));

      if (options.renderToHtml) {
        return resolve(html);
      }

      const page = await browser.getPage();
      await configCache(page);
      try {
        page.on('error', function (err) { reject(err instanceof Error ? err : new Error(String(err))) })
        page.on('pageerror', function (err) { reject(err instanceof Error ? err : new Error(String(err))) })
        if (options.haltOnConsoleError) {
          page.on('console', function (msg) {
            if (msg.type() === "error") {
              reject(new Error(`Console error while rendering the map: ${msg.text()}`));
            }
          })
        }
        await page.setViewport({
          width: Number(options.width),
          height: Number(options.height)
        });

        await page.setContent(html);
        await page.waitForFunction(() => window.mapRendered === true, { timeout: Number(options.timeout) });

        let imageBinary = await page.screenshot({
          type: options.type || 'png',
          quality: options.type === 'jpeg' ? Number(options.quality || 100) : undefined,
          fullPage: true
        });

        if (options.imagemin) {
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
          if (options.oxipng) {
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
        await page.close().catch((e) => console.log("Error closing page: " + e));
      }

    })().catch(reject)
  });
};
