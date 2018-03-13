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
    var context = {
      lat    : -34.921779,
      lng    : -57.9524339,
      zoom   : 12,
      geojson: "",
    }
    options.height = options.height || 600;
    options.width = options.width || 800;

    var html = '';
    try {
      html = template(options);
    }
    catch(e) {
      reject(e)
    }
    console.log(html)
    webshot(
      html,
      {
        siteType: 'html',
        takeShotOnCallback: true,
        windowSize: { width: options.width, height: options.height },
        timeout:15000
      },
      function(err, stream) {
        if (err) return reject(err);
        resolve(stream);
      }
    );
  })
}
