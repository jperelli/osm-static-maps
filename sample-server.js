var express = require("express"),
  http = require("http"),
  osmsm = require("./lib/lib.js");

var app = express();

// all environments
app.set("port", process.env.PORT || 3000);
app.set("views", __dirname + "/lib");
app.set("view engine", "handlebars");
app.set("view options", { layout: false });

http.createServer(app).listen(app.get("port"), function() {
  console.log("Express server listening on port " + app.get("port"));
});

app.use(function(req, res, next) {
  console.log("[" + new Date().toISOString() + "] " + req.originalUrl);
  next();
});

app.get("/", function(req, res) {
  osmsm(req.query)
    .catch(function(err) {
      res.status(500)
      res.end(err.toString());
    })
    .then(function(imageBinary) {
      res.end(imageBinary, "binary");
    });
});

app.get("/dynamic", function(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  req.query.renderToHtml = true;
  osmsm(req.query)
    .catch(function(err) {
      res.status(500);
      res.end(err.toString());
    })
    .then(function(html) {
      res.end(html);
    });
});
