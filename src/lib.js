/* global Buffer */
const fs = require('fs');
const http = require('http');
const https = require('https');
const Handlebars = require('handlebars');
const path = require('path');
const child_process = require('child_process');

let chrome = { args: [] };
let puppeteer;

if (process.env.AWS_LAMBDA_FUNCTION_VERSION) {
  // running on the Vercel platform.
  chrome = require('chrome-aws-lambda');
  puppeteer = require('puppeteer-core');
} else {
  // running locally.
  puppeteer = require('puppeteer');
}

const files = {
  leafletjs: fs.readFileSync(require.resolve('leaflet/dist/leaflet.js'), 'utf8'),
  leafletcss: fs.readFileSync(require.resolve('leaflet/dist/leaflet.css'), 'utf8'),
  leafletpolylinedecorator: fs.readFileSync(require.resolve('leaflet-polylinedecorator/dist/leaflet.polylineDecorator.js'), 'utf8'),
  mapboxjs: fs.readFileSync(require.resolve('mapbox-gl/dist/mapbox-gl.js'), 'utf8'),
  mapboxcss: fs.readFileSync(require.resolve('mapbox-gl/dist/mapbox-gl.css'), 'utf8'),
  leafletmapboxjs: fs.readFileSync(require.resolve('mapbox-gl-leaflet/leaflet-mapbox-gl.js'), 'utf8'),
  markericonpng: new Buffer.from(fs.readFileSync(require.resolve('leaflet/dist/images/marker-icon.png')), 'binary').toString('base64'),
};
const templatestr = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const template = Handlebars.compile(templatestr);


function replacefiles(str) {
  const ff = Object.entries(files);
  let res = str;
  ff.reverse();
  ff.forEach(([k, v]) => res = res.replace(`//${k}//`, v));
  return res;
}

class Browser {
  /// browser singleton
  constructor() {
    this.browser = null;
  }
  async launch() {
    const executablePath = chrome.executablePath;
    return puppeteer.launch({
      args: [...chrome.args, '--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: chrome.defaultViewport,
      executablePath,
      headless: true,
      ignoreHTTPSErrors: true,
    });
  }
  async getBrowser() {
    if (this.openingBrowser) {
      throw new Error('osm-static-maps is not ready, please wait a few seconds');
    }
    if (!this.browser || !this.browser.isConnected()) {
      this.openingBrowser = true;
      try {
        this.browser = await this.launch();
      } catch (e) {
        console.error('Error opening browser:', e);
        this.openingBrowser = false;
        throw e; // Rethrow the error to be handled by the caller
      }
      this.openingBrowser = false;
    }
    return this.browser;
  }
  async getPage() {
    const browser = await this.getBrowser();
    return browser.newPage();
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

process.on('warning', (e) => console.warn(e.stack));


// add network cache to cache tiles
const cache = {};
const cacheLocks = new Set();

// eslint-disable-next-line no-undef
function delay(ms) {
  // Using setTimeout here is intentional and necessary for the delay function
  return new Promise(resolve => setTimeout(resolve, ms));
}

// eslint-disable-next-line no-await-in-loop
async function acquireCacheLock(url) {
  while (cacheLocks.has(url)) {
    await delay(10); // wait 10ms before retrying
  }
  cacheLocks.add(url);
}

function releaseCacheLock(url) {
  cacheLocks.delete(url);
}

async function configCache(page) {
  await page.setRequestInterception(true);

  page.on('request', async (request) => {
    const url = request.url();
    await acquireCacheLock(url);
    try {
      if (cache[url] && cache[url].expires > Date.now()) {
        await request.respond(cache[url]);
      } else {
        request.continue();
      }
    } finally {
      releaseCacheLock(url);
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    await acquireCacheLock(url);
    try {
      const headers = response.headers();
      const cacheControl = headers['cache-control'] || '';
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
      const maxAge = maxAgeMatch && maxAgeMatch.length > 1 ? parseInt(maxAgeMatch[1], 10) : 0;
      if (maxAge && (!cache[url] || cache[url].expires <= Date.now())) {
        let buffer;
        try {
          buffer = await response.buffer();
        } catch {
          // some responses do not contain buffer and do not need to be cached
          return;
        }
        cache[url] = {
          status: response.status(),
          headers: response.headers(),
          body: buffer,
          expires: Date.now() + (maxAge * 1000),
        };
      }
    } finally {
      releaseCacheLock(url);
    }
  });
}

// Validation function to check if a value is a valid GeoJSON object or string
function isValidGeojson(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isValidGeojsonObject(parsed);
    } catch {
      return false; // Not a valid JSON string
    }
  } else if (typeof value === 'object' && value !== null) {
    return isValidGeojsonObject(value);
  }
  return false; // Not a valid type for GeoJSON
}

// Helper function to check if an object is a valid GeoJSON structure
function isValidGeojsonObject(obj) {
  // Basic check for type and features properties
  return Object.prototype.hasOwnProperty.call(obj, 'type') && Object.prototype.hasOwnProperty.call(obj, 'features') &&
         obj.type === 'FeatureCollection' && Array.isArray(obj.features);
}

// Validation helper functions
function isString(value) {
  return typeof value === 'string';
}

function isNumber(value) {
  return typeof value === 'number' && !isNaN(value);
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTemplateInjection(value) {
  const templateInjectionRegex = /{{\s*[\w.-]+\s*}}/;
  return templateInjectionRegex.test(value);
}

module.exports = function(options) {
  options = options || {};

  // Define default values and validation functions for options
  const optionConfigs = {
    geojson: { default: '', validate: isValidGeojson },
    geojsonfile: { default: '', validate: isString },
    height: { default: 600, validate: isNumber },
    width: { default: 800, validate: isNumber },
    center: { default: '', validate: (val) => isString(val) && !hasTemplateInjection(val) },
    zoom: { default: '', validate: isNumber },
    maxZoom: { default: (options) => options.vectorserverUrl ? 20 : 17, validate: isNumber },
    attribution: { default: 'osm-static-maps | © OpenStreetMap contributors', validate: (val) => isString(val) && !hasTemplateInjection(val) },
    tileserverUrl: { default: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', validate: (val) => isString(val) && !hasTemplateInjection(val) },
    vectorserverUrl: { default: '', validate: (val) => isString(val) && !hasTemplateInjection(val) },
    vectorserverToken: { default: 'no-token', validate: (val) => isString(val) && !hasTemplateInjection(val) },
    imagemin: { default: false, validate: isBoolean },
    oxipng: { default: false, validate: isBoolean },
    arrows: { default: false, validate: isBoolean },
    scale: { default: false, validate: (val) => isBoolean(val) || isObject(val) },
    markerIconOptions: { default: false, validate: isObject },
    style: { default: false, validate: isObject },
    timeout: { default: 20000, validate: isNumber },
    haltOnConsoleError: { default: false, validate: isBoolean }
  };

  // Apply default values and validations
  Object.entries(optionConfigs).forEach(([key, config]) => {
    options[key] = options[key] !== undefined ? options[key] : config.default;
    if (typeof config.default === 'function') {
      options[key] = config.default(options);
    }
    if (!config.validate(options[key])) {
      throw new Error(`Invalid ${key} parameter: must be a ${typeof config.default} without template injection`);
    }
  });

  // Removed redundant validation call

  return new Promise(function(resolve, reject) {
    (async () => {

      if (options.geojsonfile) {
        if (options.geojson) {
          throw new Error('Only one option allowed: \'geojsonfile\' or \'geojson\'');
        }
        if (options.geojsonfile.startsWith('http://') || options.geojsonfile.startsWith('https://')) {
          options.geojson = await httpGet(options.geojsonfile).catch(e => { throw new Error(`Failed to get geojson file: ${e.message}`); });
        }
        else {
          options.geojson = fs.readFileSync(
            options.geojsonfile == '-'
              ? process.stdin.fd
              : options.geojsonfile,
            'utf8'
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
        page.on('error', function (err) { reject(err.toString()); });
        page.on('pageerror', function (err) { reject(err.toString()); });
        if (options.haltOnConsoleError) {
          page.on('console', function (msg) {
            if (msg.type() === 'error') {
              reject(JSON.stringify(msg));
            }
          });
        }
        await page.setViewport({
          width: Number(options.width),
          height: Number(options.height)
        });

        await page.setContent(html);
        // The 'window' object is used here in the context of the browser environment provided by puppeteer
        await page.evaluate(() => {
          return new Promise((resolve, reject) => {
            if (window.mapRendered === true) {
              resolve();
            } else {
              reject('Map not rendered within the specified timeout.');
            }
          });
        });

        let imageBinary = await page.screenshot({
          type: options.type || 'png',
          quality: options.type === 'jpeg' ? Number(options.quality || 100) : undefined,
          fullPage: true
        });

        if (options.imagemin) {
          const imagemin = require('imagemin');
          const imageminJpegtran = require('imagemin-jpegtran');
          const imageminOptipng = require('imagemin-optipng');
          const plugins = [];
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
            ));
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
        console.log('PAGE CLOSED with err' + e);
        throw(e);
      }
      page.close();

    })().catch(reject);
  });
};

// Simple test case to validate the module functionality
if (require.main === module) {
  const testOptions = {
    geojson: { type: 'FeatureCollection', features: [] },
    height: 600,
    width: 800,
    center: '48.8588443,2.2943506',
    zoom: 10,
    maxZoom: 17,
    attribution: 'osm-static-maps | © OpenStreetMap contributors',
    tileserverUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    vectorserverUrl: '',
    vectorserverToken: 'validString',
    imagemin: false,
    oxipng: false,
    arrows: false,
    scale: false,
    markerIconOptions: {},
    style: {},
    timeout: 20000,
    haltOnConsoleError: false
  };

  module.exports(testOptions).then(console.log).catch(console.error);
}
