const express = require("express"),
  http = require("http"),
  osmsm = require("./lib.js");

const app = express();
// app.set("port", process.env.PORT || 3000);
app.set("views", __dirname + "/lib");
app.set("view engine", "handlebars");
app.set("view options", { layout: false });
app.use(express.json({ limit: "50mb" }));

app.use((req, res, next) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const date = new Date().toISOString();
  const ref = req.header("Referer");
  const ua = req.header("user-agent");
  const url = req.originalUrl;
  const logLine = `[${date} - ${ip}] (${ref}) {${ua}} ${url}`;
  if (process.env.HEADER_CHECK) {
    const header = process.env.HEADER_CHECK.split(":");
    if (req.headers[header[0]] !== header[1]) {
      res
        .status(403)
        .send(
          process.env.HEADER_CHECK_FAIL_MESSAGE ||
            "Forbidden, set correct header to access"
        );
      console.log(`${logLine} FORBIDDEN, HEADER_CHECK FAILED`);
      return;
    }
  }
  console.log(logLine);
  next();
});


function htmlEscape(text) {
  return text.replace(/&/g, '&amp;').
  replace(/</g, '&lt;').
  replace(/"/g, '&quot;').
  replace(/'/g, '&#039;');
}

function sanitize(params) {
  let result = {}
  for (let [key, value] of Object.entries(params)) {
      result[key] = htmlEscape(value)
  }
  return result;
}

app.get("/health", (req, res) => res.sendStatus(200));

const handler = (res, params) => {
  const filename = params.f || params.geojsonfile
  if (
    filename &&
    !(filename.startsWith("http://") ||
    filename.startsWith("https://"))
  ) {
    throw new Error(
      `'geojsonfile' parameter on server only allowed if filename starts with http(s)`
    );
  }
  osmsm(params)
    .then((data) => res.end(data))
    .catch((err) => res.status(500).end(err.toString()));
};

app.get("/", (req, res) => handler(res, req.query));
app.post("/", (req, res) => handler(res, req.body));

app.get("/dynamic", (req, res) => {
  var sanitized = sanitize(req.query)
  handler(res, { ...sanitized, renderToHtml: true })
})

app.post("/dynamic", (req, res) => {
  var sanitized = sanitize(req.body)
  handler(res, { ...sanitized, renderToHtml: true })
})

module.exports = http.createServer(app);
