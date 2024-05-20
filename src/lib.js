const fs = require('fs');
const http = require('http');
const https = require("https");
const Handlebars = require('handlebars');
const path = require('path');
const child_process = require("child_process");

let chrome = { args: [] };
let puppeteer;

if (process.env.AWS_LAMBDA_FUNCTION_VERSION) {
  // running on the Vercel platform.
  chrome = require("chrome-aws-lambda");
  puppeteer = require("puppeteer-core");
} else {
  // running locally.
  puppeteer = require("puppeteer");
}

const files = {
  leafletjs: fs.readFileSync(require.resolve('leaflet/dist/leaflet.js'), 'utf8'),
  leafletcss: fs.readFileSync(require.resolve('leaflet/dist/leaflet.css'), 'utf8'),
  leafletpolylinedecorator: fs.readFileSync(require.resolve('leaflet-polylinedecorator/dist/leaflet.polylineDecorator.js'), 'utf8'),
  mapboxjs: fs.readFileSync(require.resolve('mapbox-gl/dist/mapbox-gl.js'), 'utf8'),
  mapboxcss: fs.readFileSync(require.resolve('mapbox-gl/dist/mapbox-gl.css'), 'utf8'),
  leafletmapboxjs: fs.readFileSync(require.resolve('mapbox-gl-leaflet/leaflet-mapbox-gl.js'), 'utf8'),
  markericonpng: new Buffer.from(fs.readFileSync(require.resolve('leaflet/dist/images/marker-icon.png')), 'binary').toString('base64'),
}
const templatestr = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
const template = Handlebars.compile(templatestr);


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
    const executablePath = await chrome.executablePath
    return puppeteer.launch({
      args: [...chrome.args, "--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: chrome.defaultViewport,
      executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
    });
  }
  async getBrowser() {
    if (this.openingBrowser) {
      throw new Error('osm-static-maps is not ready, please wait a few seconds')
    }
    if (!this.browser || !this.browser.isConnected()) {
      this.openingBrowser = true;
      try {
        this.browser = await this.launch();
      }
      catch (e) {
        console.log('Error opening browser')
        console.log(JSON.stringify(e, undefined, 2))
      }
      this.openingBrowser = false;
    }
    return this.browser
  }
  async getPage() {
    const browser = await this.getBrowser()
    return browser.newPage()
  }
}
const browser = new Browser();


function httpGet(url) {
  // from https://stackoverflow.com/a/41471647/912450
  const httpx = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    let req = httpx.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(`Error ${res.statusCode} trying to get geojson file from ${url}`);
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

module.exports = function(options) {
  return new Promise(function(resolve, reject) {
    // Validate options to avoid template injection
    options = options || {};

    // Helper function to parse boolean values
    function parseBoolean(value, paramName) {
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
        throw new Error(`Validation error: ${paramName} should be a boolean`);
      }
      if (typeof value !== 'boolean') {
        throw new Error(`Validation error: ${paramName} should be a boolean`);
      }
      return value;
    }

    // Helper function to parse number values
    function parseNumber(value, paramName) {
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (isNaN(parsed)) throw new Error(`Validation error: ${paramName} should be a number`);
        return parsed;
      }
      if (typeof value !== 'number') {
        throw new Error(`Validation error: ${paramName} should be a number`);
      }
      return value;
    }

    // Helper function to parse JSON values
    function parseJSON(value, paramName) {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch (e) {
          throw new Error(`Validation error: ${paramName} should be a valid JSON`);
        }
      }
      if (typeof value !== 'object') {
        throw new Error(`Validation error: ${paramName} should be a valid JSON`);
      }
      return value;
    }

    // Helper function to validate strings for handlebars injection
    function validateString(value, paramName) {
      if (typeof value !== 'string') {
        throw new Error(`Validation error: ${paramName} should be a string`);
      }
      if (Handlebars.compile(value) !== value) {
        throw new Error(`Validation error: ${paramName} contains handlebars template injection`);
      }
      return value;
    }

    options.geojson = (options.geojson && (typeof options.geojson === 'string' ? options.geojson : JSON.stringify(options.geojson))) || '';
    options.geojsonfile = options.geojsonfile || '';
    options.height = parseNumber(options.height || 600, 'height');
    options.width = parseNumber(options.width || 800, 'width');
    options.center = validateString(options.center || '', 'center');
    options.zoom = parseNumber(options.zoom || '', 'zoom');
    options.maxZoom = parseNumber(options.maxZoom || (options.vectorserverUrl ? 20 : 17), 'maxZoom');
    options.attribution = validateString(options.attribution || 'osm-static-maps | © OpenStreetMap contributors', 'attribution');
    options.tileserverUrl = validateString(options.tileserverUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 'tileserverUrl');
    options.vectorserverUrl = validateString(options.vectorserverUrl || '', 'vectorserverUrl');
    options.vectorserverToken = validateString(options.vectorserverToken || 'no-token', 'vectorserverToken');
    options.imagemin = parseBoolean(options.imagemin || false, 'imagemin');
    options.oxipng = parseBoolean(options.oxipng || false, 'oxipng');
    options.arrows = parseBoolean(options.arrows || false, 'arrows');
    options.scale = parseJSON(options.scale || false, 'scale');
    options.markerIconOptions = parseJSON(options.markerIconOptions || false, 'markerIconOptions');
    options.style = parseJSON(options.style || false, 'style');
    options.timeout = parseNumber(typeof options.timeout == undefined ? 20000 : options.timeout, 'timeout');
    options.haltOnConsoleError = parseBoolean(!!options.haltOnConsoleError, 'haltOnConsoleError');

    (async () => {

      if (options.geojsonfile) {
        if (options.geojson) {
          throw new Error(`Only one option allowed: 'geojsonfile' or 'geojson'`)
        }
        if (options.geojsonfile.startsWith("http://") || options.geojsonfile.startsWith("https://")) {
          options.geojson = await httpGet(options.geojsonfile)
        }
        else {
          options.geojson = fs.readFileSync(
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
        page.on('error', function (err) { reject(err.toString()) })
        page.on('pageerror', function (err) { reject(err.toString()) })
        if (options.haltOnConsoleError) {
          page.on('console', function (msg) {
            if (msg.type() === "error") {
              reject(JSON.stringify(msg));
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
          const imagemin = require("imagemin");
          const imageminJpegtran = require("imagemin-jpegtran");
          const imageminOptipng = require("imagemin-optipng");
          const plugins = []
          if (options.type === 'jpeg') {
            plugins.push(imageminJpegtran());
          } else {
            plugins.push(imageminOptipng());
          }
          (async () => {
            resolve(await imagemin.buffer(
              imageBinary,
              {
                plugins,
              }
            ))
          })();
        } else {
          if (options.oxipng) {
            const child = child_process.spawn('/root/.cargo/bin/oxipng', ['-']);
            child.stdin.on('error', function() {});
            child.stdin.write(imageBinary);
            child.stdin.end();
            let newimg = [];
            child.stdout.on('data', data => newimg.push(data));
            child.on('close', () => resolve(Buffer.concat(newimg)));
            child.on('error', e => reject(e.toString()));
          } else {
            resolve(imageBinary);
          }
        }

      }
      catch(e) {
        page.close();
        console.log("PAGE CLOSED with err" + e);
        throw(e);
      }
      page.close();

    })().catch(reject)
  });
};
