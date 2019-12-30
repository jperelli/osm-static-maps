const fs = require("fs");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const path = require("path");

Handlebars.registerPartial(
  'leafletjs',
  fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.js'), "utf8")
)
Handlebars.registerPartial(
  'leafletcss',
  fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.css'), "utf8")
)
Handlebars.registerPartial(
  'markericonpng',
  new Buffer(fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'images', 'marker-icon.png')), 'binary').toString('base64')
)
const template = Handlebars.compile(fs.readFileSync(path.join(__dirname, 'template.html'), "utf8"))

module.exports = function(options) {
  return new Promise(function(resolve, reject) {
    options.lat = options.lat || -34.921779;
    options.lng = options.lng || -57.9524339;
    options.zoom = options.zoom || 12;
    options.geojson = options.geojson || "";
    options.height = options.height || 600;
    options.width = options.width || 800;
    options.tileserverUrl =
      options.tileserverUrl ||
      "http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

    const html = template(options);
    (async () => {
      const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      const page = await browser.newPage();
      page.on("error", function (err) { reject(err.toString()) })
      page.on("pageerror", function (err) { reject(err.toString()) })
      page.on('console', function (msg) { reject(JSON.stringify(msg)) })
      await page.setViewport({
        width: Number(options.width),
        height: Number(options.height)
      });
      await page.setContent(html, { waitUntil: "networkidle0" });

      const imageBinary = await page.screenshot({ fullPage: true });

      browser.close();

      resolve(imageBinary);
    })()
  });
};
