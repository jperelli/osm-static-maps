const express = require('express'),
  http = require('http'),
  { main: osmsm, isValidGeojson } = require('./lib.js');
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

const handler = (res, params, reqDetails) => {
  // Log that the handler function was called
  logStream.write(`Handler function called with params: ${JSON.stringify(params)}\n`);
  const logParams = `Received parameters: ${JSON.stringify(params)}\n`; // Log the received parameters
  logStream.write(logParams);
  // Additional logging for debugging purposes
  if (reqDetails) {
    const logReqDetails = `Full request details: ${JSON.stringify(reqDetails)}\n`;
    logStream.write(logReqDetails);
  }
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
  // Additional logging to capture the geojson parameter before it is passed to the osmsm function
  if (params.geojson) {
    logStream.write(`GeoJSON parameter before osmsm call: ${params.geojson}\n`);
    // Parse the geojson parameter to ensure it is a valid JSON object
    try {
      const parsedGeojson = JSON.parse(params.geojson);
      // Validate the parsed GeoJSON object before proceeding
      if (!isValidGeojson(parsedGeojson)) {
        throw new Error('Parsed GeoJSON object is not valid.');
      }
      logStream.write(`Parsed GeoJSON parameter: ${JSON.stringify(parsedGeojson)}\n`);
      // Replace the stringified geojson with the parsed object
      params.geojson = parsedGeojson;
    } catch (error) {
      logStream.write(`Error parsing GeoJSON parameter: ${error}\n`);
      res.status(400).send(`Invalid GeoJSON parameter: ${error.message}`);
      return;
    }
  }
  osmsm(params)
    .then((data) => res.end(data))
    .catch((err) => {
      const logError = `Error in osmsm: ${err}\n`; // Log the error from osmsm
      logStream.write(logError);
      res.status(500).end(err.toString());
    });
};

app.get('/', (req, res) => {
  // Additional logging for debugging purposes
  logStream.write(`GET request body: ${JSON.stringify(req.query)}\n`);
  // Log the full request details
  logStream.write(`Full GET request details: Headers - ${JSON.stringify(req.headers)}, Query - ${JSON.stringify(req.query)}\n`);
  handler(res, req.query, { headers: req.headers, query: req.query });
});
app.post('/', (req, res) => {
  // Additional logging for debugging purposes
  logStream.write(`POST request body: ${JSON.stringify(req.body)}\n`);
  // Log the full request details
  logStream.write(`Full POST request details: Headers - ${JSON.stringify(req.headers)}, Body - ${JSON.stringify(req.body)}\n`);
  handler(res, req.body, { headers: req.headers, body: req.body });
});

app.get('/dynamic', (req, res) => {
  handler(res, { ...req.query, renderToHtml: true });
});

app.post('/dynamic', (req, res) => {
  handler(res, { ...req.body, renderToHtml: true });
});

module.exports = http.createServer(app);
