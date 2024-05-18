const express = require('express'),
  http = require('http'),
  osmsm = require('./lib.js');
const fs = require('fs');

const app = express();
// app.set("port", process.env.PORT || 3000);
app.set('views', __dirname + '/lib');
app.set('view engine', 'handlebars');
app.set('view options', { layout: false });
app.use(express.json({ limit: '50mb' }));

const logStream = fs.createWriteStream('/home/ubuntu/osm-static-maps/server.log', { flags: 'a' });

app.use((req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const date = new Date().toISOString();
  const ref = req.header('Referer');
  const ua = req.header('user-agent');
  const url = req.originalUrl;
  const logLine = `[${date} - ${ip}] (${ref}) {${ua}} ${url}\n`;
  if (process.env.HEADER_CHECK) {
    const header = process.env.HEADER_CHECK.split(':');
    if (req.headers[header[0]] !== header[1]) {
      res
        .status(403)
        .send(
          process.env.HEADER_CHECK_FAIL_MESSAGE ||
            'Forbidden, set correct header to access'
        );
      logStream.write(`${logLine} FORBIDDEN, HEADER_CHECK FAILED\n`);
      return;
    }
  }
  logStream.write(logLine);
  next();
});

app.get('/health', (req, res) => res.sendStatus(200));

const handler = (res, params) => {
  const logParams = `Received parameters: ${JSON.stringify(params)}\n`; // Log the received parameters
  logStream.write(logParams);
  const filename = params.f || params.geojsonfile;
  if (
    filename &&
    !(filename.startsWith('http://') ||
    filename.startsWith('https://'))
  ) {
    const error = new Error(
      '\'geojsonfile\' parameter on server only allowed if filename starts with http(s)'
    );
    logStream.write(`Error: ${error}\n`);
    throw error;
  }
  osmsm(params)
    .then((data) => res.end(data))
    .catch((err) => {
      const logError = `Error in osmsm: ${err}\n`; // Log the error from osmsm
      logStream.write(logError);
      res.status(500).end(err.toString());
    });
};

app.get('/', (req, res) => handler(res, req.query));
app.post('/', (req, res) => handler(res, req.body));

app.get('/dynamic', (req, res) => {
  handler(res, { ...req.query, renderToHtml: true });
});

app.post('/dynamic', (req, res) => {
  handler(res, { ...req.body, renderToHtml: true });
});

module.exports = http.createServer(app);
