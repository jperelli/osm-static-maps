const fs = require('fs');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const path = require('path');

const files = {
  leafletjs: fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.js'), 'utf8'),
  leafletcss: fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.css'), 'utf8'),
  mapboxjs: fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'mapbox-gl', 'dist', 'mapbox-gl.js'), 'utf8'),
  mapboxcss: fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'mapbox-gl', 'dist', 'mapbox-gl.css'), 'utf8'),
  leafletmapboxjs: fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'mapbox-gl-leaflet', 'leaflet-mapbox-gl.js'), 'utf8'),
  markericonpng: new Buffer.from(fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'images', 'marker-icon.png')), 'binary').toString('base64'),
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

module.exports = function(options) {
  return new Promise(function(resolve, reject) {
    options.geojson = options.geojson || '';
    options.height = options.height || 600;
    options.width = options.width || 800;
    options.center = options.center || '';
    options.zoom = options.zoom || '';
    options.maxZoom = options.maxZoom || 20;
    options.attribution = options.attribution || 'osm-static-maps | © OpenStreetMap contributors';
    options.tileserverUrl = options.tileserverUrl || 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    options.vectorserverUrl = options.vectorserverUrl || '';
    options.vectorserverToken = options.vectorserverToken || 'no-token';

    const html = replacefiles(template(options));

    if (options.renderToHtml) {
      return resolve(html);
    }

    (async () => {
      const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      page.on('error', function (err) { reject(err.toString()) })
      page.on('pageerror', function (err) { reject(err.toString()) })
      page.on('console', function (msg, type) {
        if (msg.type === 'error') {
          reject(JSON.stringify(msg))
        }
      })
      await page.setViewport({
        width: Number(options.width),
        height: Number(options.height)
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const imageBinary = await page.screenshot({ type: options.type || 'png', quality: options.type === 'jpeg' ? Number(options.quality || 100) : undefined, fullPage: true });

      browser.close();

      resolve(imageBinary);
    })()
  });
};
