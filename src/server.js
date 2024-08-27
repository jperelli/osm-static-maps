import express, { json } from "express";
import { createServer } from "http";
import osmsm from "./lib.js";
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// app.set("port", process.env.PORT || 3000);
app.set("views", __dirname + "/lib");
app.set("view engine", "handlebars");
app.set("view options", { layout: false });
app.use(json({ limit: "50mb" }));

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
  handler(res, { ...req.query, renderToHtml: true })
})

app.post("/dynamic", (req, res) => {
  handler(res, { ...req.body, renderToHtml: true })
})

export default createServer(app);
