var express = require("express"),
  http = require("http"),
  osmsm = require("./lib/lib.js");

var app = express();
app.set("port", process.env.PORT || 3000);
app.set("views", __dirname + "/lib");
app.set("view engine", "handlebars");
app.set("view options", { layout: false });
app.use(express.json({ limit: "50mb" }));

http
  .createServer(app)
  .listen(app.get("port"), () =>
    console.log("Express server listening on port " + app.get("port"))
  );

app.use((req, res, next) => {
  console.log(
    "[" +
      new Date().toISOString() +
      "] " +
      " (" +
      req.headers.referer +
      ") " +
      req.originalUrl
  );
  next();
});

const handler = (res, params) => {
  osmsm(params)
    .then(data => res.end(data))
    .catch(err => res.status(500).end(err.toString()));
};

app.get("/", (req, res) => handler(res, req.query));
app.post("/", (req, res) => handler(res, req.body));

app.get("/dynamic", (req, res) =>
  handler(res, { ...req.query, renderToHtml: true })
);

app.post("/dynamic", (req, res) =>
  handler(res, { ...req.body, renderToHtml: true })
);
