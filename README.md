# osm-static-maps

[![CI](https://github.com/jperelli/osm-static-maps/actions/workflows/ci.yml/badge.svg)](https://github.com/jperelli/osm-static-maps/actions/workflows/ci.yml)

Openstreetmap static maps is a nodejs lib, CLI and server open source inspired on google static map service

Here you have a [demo](http://localhost:3000/?geojson=[{"type":"Feature","properties":{"party":"Republican"},"geometry":{"type":"Polygon","coordinates":[[[-104.05,48.99],[-97.22,48.98],[-96.58,45.94],[-104.03,45.94],[-104.05,48.99]]]}},{"type":"Feature","properties":{"party":"Democrat"},"geometry":{"type":"Polygon","coordinates":[[[-109.05,41.00],[-102.06,40.99],[-102.03,36.99],[-109.04,36.99],[-109.05,41.00]]]}}]&height=300&width=300 "Just what I wanted!"). Also a [dynamic version](http://localhost:3000/dynamic?geojson=[{"type":"Feature","properties":{"party":"Republican"},"geometry":{"type":"Polygon","coordinates":[[[-104.05,48.99],[-97.22,48.98],[-96.58,45.94],[-104.03,45.94],[-104.05,48.99]]]}},{"type":"Feature","properties":{"party":"Democrat"},"geometry":{"type":"Polygon","coordinates":[[[-109.05,41.00],[-102.06,40.99],[-102.03,36.99],[-109.04,36.99],[-109.05,41.00]]]}}]&height=300&width=300 "Wow it gets even better!!") of the demo, for testing purposes.

## How to use

### 1. CLI

The quickest way, with no install required, is via `npx`:

```bash
npx osmsm --help
npx osmsm -g '{"type":"Point","coordinates":[-105.01621,39.57422]}' > map.png

# or, if chrome executable is not found
PUPPETEER_EXECUTABLE_PATH=/path/to/chrome npx osmsm -g '...' > map.png
```

Or install it globally to get the `osmsm` command:

```bash
sudo npm i -g osm-static-maps
osmsm --help
osmsm -g '{"type":"Point","coordinates":[-105.01621,39.57422]}' > map.png
```

* note: if you have this error trying to install globally `Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/osm-static-maps/node_modules/puppeteer/.local-chromium'`, it's caused by this pupeteer issue https://github.com/puppeteer/puppeteer/issues/367, you can workaround by installing globally with the `unsafe-perm` flag:

```bash
sudo npm i -g osm-static-maps --unsafe-perm=true
```

### 2. nodejs library

```bash
npm install osm-static-maps
```

```javascript
// index.js old school
osmsm = require('osm-static-maps');
osmsm({geojson: geojson})
  .then(function(imageBinaryBuffer) { ... })
  .catch(function(error) { ... })

// index.js modern style (also supports typescript)
import osmsm from 'osm-static-maps'
const imageBinaryBuffer = await osmsm({geojson})
```

### 3. Standalone sample server

```bash
npx osmsm serve
```

Or install it globally:

```bash
sudo npm i -g osm-static-maps
osmsm serve
```

Or you can use docker-compose
```bash
git clone git@github.com:jperelli/osm-static-maps.git
cd osm-static-maps
docker-compose up
```

#### Server configuration (access control)

Rendering a map is expensive, so a publicly reachable server is an easy target for abuse (for example other sites hotlinking `<img src="https://your-server/?geojson=...">`). The sample server ships with a few **opt-in** gates, all configured with environment variables. By default none of them is active and the server answers every request.

| Variable | Description | Default |
| ---- | ---- | ---- |
| `PORT` | port to listen on (also `osmsm serve -p <port>`) | `3000` |
| `HEADER_CHECK` | `name:value` of a header every request must carry, e.g. `x-api-key:s3cret`. Useful for server-to-server usage; answers `403` otherwise | `undefined` (disabled) |
| `HEADER_CHECK_FAIL_MESSAGE` | body of the `403` response when `HEADER_CHECK` fails | `Forbidden, set correct header to access` |
| `ALLOWED_REFERERS` | comma separated list of hostnames allowed to embed maps, checked against the `Referer` header. `*.example.com` matches `example.com` and all its subdomains; the special value `none` allows requests carrying no `Referer` at all (direct API calls, `curl`...). Anything else answers `403` | `undefined` (disabled) |
| `ALLOWED_REFERERS_FAIL_MESSAGE` | body of the `403` response when the `Referer` is not allowed | `Forbidden, hotlinking from this site is not allowed` |
| `RATE_LIMIT_MAX` | max number of map requests per client IP in each window; exceeding it answers `429` with a `Retry-After` header. The client IP is taken from the first `X-Forwarded-For` entry when present, so only enable it behind a trusted reverse proxy or on a directly exposed server | `undefined` (disabled) |
| `RATE_LIMIT_WINDOW` | length of the rate limit window, in seconds | `60` |
| `RATE_LIMIT_FAIL_MESSAGE` | body of the `429` response | `Too many requests, slow down` |

The `/health` endpoint is never rate limited nor referer-checked, so container health checks keep working; it is still subject to `HEADER_CHECK`.

```bash
# only let mysite.com (and its subdomains) embed maps, plus direct calls without a Referer,
# and cap each client at 30 renders per minute
ALLOWED_REFERERS='none,*.mysite.com' RATE_LIMIT_MAX=30 RATE_LIMIT_WINDOW=60 osmsm serve
```

The rate limiter is a simple in-memory, per-process counter meant as a safety net. For a production deployment (multiple processes, distributed limits, caching) put a reverse proxy such as nginx in front of the server.

### 4. Cloud service

You can use the heroku-hosted alternative directly [here](http://osm-static-maps.herokuapp.com/ "Awesome!")

We are currently in the cloud beta, contact me directly at jperelli+osmsm@gmail.com so I can give you access to the cloud service.

## API Reference

All parameters have a short and long version. The short version can be used only with the shell CLI. The long version can be used with the library and can be passed to the app server as GET query params, or POST json body (remember to set the header `Content-Type: application/json`)

|   | Parameter | Description | Default Value |
| - | ---- | ---- | ---- |
| g | geojson | geojson object to be rendered in the map | `undefined` |
| f | geojsonfile | filename or url to read geojson data from (use '-' to read from stdin on CLI) | `undefined` |
| H | height | height in pixels of the returned img | `600` |
| W | width | height in pixels of the returned img | `800` |
| c | center | center of the map lon,lat floats string | (center of the geojson) or `'-57.9524339,-34.921779'` |
| z | zoom | zoomlevel of the leaflet map | value of `maxZoom` |
| Z | maxZoom | max zoomlevel of the leaflet map | `17` |
| A | attribution | attribution legend | `'osm-static-maps / © OpenStreetMap contributors'` (or `'osm-static-maps'` when `vectorserverUrl` is set) |
| t | tileserverUrl | url of a tileserver | `'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'` |
| m | vectorserverUrl | url of a vector tile server (MVT style.json) | `undefined` |
| M | vectorserverToken | used as `Authorization: Bearer <token>` header on vector map requests | `undefined` |
|   | vectorserverAttribution | append the vector layers source attributions (CLI: `--no-vectorserverAttribution` to disable) | `true` |
| D | renderToHtml | returns html of the webpage containing the map (instead of a binary image) | `false` |
| F | type | format of the image returned (`'jpeg'`/`'png'`) | `'png'` |
| q | quality | quality of the image returned (`0`-`100`, only for `jpg`) | `100` |
| x | imagemin | enable lossless compression with [optipng](https://github.com/imagemin/imagemin-optipng) / [jpegtran](https://github.com/imagemin/imagemin-jpegtran) | `false` |
| X | oxipng | enable losslsess compression with [oxipng](https://github.com/shssoichiro/oxipng) | `false` |
| a | arrows | render arrows to show the direction of linestrings | `false` |
| s | scale | enable render a scale ruler (boolean or [a json options object](https://leafletjs.com/reference-1.9.4.html#control-scale-option)) | `false` |
| T | timeout | miliseconds until page load throws timeout | `20000` |
| k | markerIconOptions | set marker icon options ([a json options object](https://leafletjs.com/reference-1.9.4.html#icon-option)) *see note | `undefined` (leaflet's default marker) |
| S | style | style to apply to each feature ([a json options object](https://leafletjs.com/reference-1.9.4.html#path-option)) *see note | `undefined` (leaflet's default) |
| e | haltOnConsoleError | throw error if there is any `console.error(...)` when rendering the map image | `false` |

* Note on markerIconOptions: it's also accepted a markerIconOptions attribute in the geojson feature, for example `{"type":"Point","coordinates":[-105.01621,39.57422],"markerIconOptions":{"iconUrl":"https://leafletjs.com/examples/custom-icons/leaf-red.png"}}`

* Note on style: it's also accepted a pathOptions attribute in the geojson feature, for example `{"type":"Polygon","coordinates":[[[-56.698,-36.413],[-56.716,-36.348],[-56.739,-36.311]]],"pathOptions":{"color":"#FF5555"}}` (also remember that the `#` char needs to be passed as `%23` if you are using GET params)

## Development

```bash
git clone git@github.com:jperelli/osm-static-maps.git
cd osm-static-maps
npm install
npm run dev    # start the sample server with autoreload
npm test       # run the test suite (vitest)
```

Running the library/CLI/server requires **Node >= 20** (see `engines`). The test
toolchain (vitest/vite) is stricter and needs **Node 20.19+, 22.12+, or 24+** —
this only matters for contributors running `npm test`, not for consumers of the
published package. The CI matrix runs the tests on Node 20, 22, 24 and 26.

## Design considerations & architecture

[Read the blogpost](https://jperelli.com.ar/project/2019/10/01/osm-static-maps/) on the creation of this library and how it works internally

## LICENSE

 - GPL-2.0-only

## Credits

Specially to the contributors of

- OpenStreetMap
- Leaflet
- Puppeteer
- ExpressJS
- Handlebars

