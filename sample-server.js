var express = require("express"),
  http = require("http"),
  engines = require("consolidate"),
  osmsm = require("./lib/lib.js");

var app = express();

// all environments
app.set("port", process.env.PORT || 3000);
app.set("views", __dirname + "/lib");
app.set("view engine", "handlebars");
app.set("view options", { layout: false });
app.engine(".html", engines.handlebars);

http.createServer(app).listen(app.get("port"), function() {
  console.log("Express server listening on port " + app.get("port"));
});

app.use(function(req, res, next) {
  console.log("[" + new Date().toISOString() + "] " + req.originalUrl);
  next();
});

function makeContext(req) {
  var context = {
    lat: -34.921779,
    lng: -57.9524339,
    zoom: 12,
    geojson: "",
    tileserverUrl: "http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  };
  if (req.query.geojson) {
    context.geojson = req.query.geojson;
  }
  return context;
}

app.get("/", function(req, res) {
  var height;
  var width;

  if (req.query.height) height = req.query.height;
  if (req.query.width) width = req.query.width;

  var context = makeContext(req);

  osmsm({
    height: height,
    width: width,
    lat: context.lat,
    lng: context.lng,
    zoom: context.zoom,
    geojson: context.geojson,
    // tileserverUrl: "http://korona.geog.uni-heidelberg.de/tiles/roads/x={x}&y={y}&z={z}"
  })
    .catch(function(err) {
      res.status(500)
      res.end(err.toString());
    })
    .then(function(imageBinary) {
      res.end(imageBinary, "binary");
    });
});

app.get("/dynamic", function(req, res) {
  var context = makeContext(req);
  res.render("template.html", context);
});
