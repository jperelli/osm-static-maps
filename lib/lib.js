var fs = require('fs');
var Handlebars = require('handlebars');
var webshot = require('webshot');
var path = require("path");

Handlebars.registerPartial(
  'leafletjs',
  fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.js'), "utf8")
)
Handlebars.registerPartial(
  'leafletcss',
  fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', 'leaflet.css'), "utf8")
)
var template = Handlebars.compile(fs.readFileSync(path.join(__dirname, 'template.html'), "utf8"))

module.exports = function(options) {
  return new Promise(function(resolve, reject) {
    options.lat = options.lat || -34.921779;
    options.lng = options.lng || -57.9524339;
    options.zoom = options.zoom || 12;
    options.geojson = options.geojson || "";
    options.height = options.height || 600;
    options.width = options.width || 800;
    options.tileserverUrl = options.tileserverUrl || 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    var html = '';
    try {
      html = template(options);
    }
    catch(e) {
      reject(e)
    }
    webshot(
      html,
      {
        siteType: 'html',
        takeShotOnCallback: true,
        windowSize: { width: options.width, height: options.height },
        timeout:15000,
        errorIfJSException: true
      },
      function(err, stream) {
        if (err) return reject(err, html);
        resolve(stream);
      }
    );
  })
}
