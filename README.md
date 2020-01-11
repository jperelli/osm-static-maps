# osm-static-maps

This pretends to be inspired in Google(c) static map service. But made using open source technologies.

You can find osm-static-maps [running in heroku](http://osm-static-maps.herokuapp.com/ "Fabulous!")

Here you have a [demo](http://osm-static-maps.herokuapp.com/?geojson=[{"type":"Feature","properties":{"party":"Republican"},"geometry":{"type":"Polygon","coordinates":[[[-104.05,48.99],[-97.22,48.98],[-96.58,45.94],[-104.03,45.94],[-104.05,48.99]]]}},{"type":"Feature","properties":{"party":"Democrat"},"geometry":{"type":"Polygon","coordinates":[[[-109.05,41.00],[-102.06,40.99],[-102.03,36.99],[-109.04,36.99],[-109.05,41.00]]]}}]&height=300&width=300 "Just what I wanted!")

And a [dynamic version](http://osm-static-maps.herokuapp.com/dynamic?geojson=[{"type":"Feature","properties":{"party":"Republican"},"geometry":{"type":"Polygon","coordinates":[[[-104.05,48.99],[-97.22,48.98],[-96.58,45.94],[-104.03,45.94],[-104.05,48.99]]]}},{"type":"Feature","properties":{"party":"Democrat"},"geometry":{"type":"Polygon","coordinates":[[[-109.05,41.00],[-102.06,40.99],[-102.03,36.99],[-109.04,36.99],[-109.05,41.00]]]}}]&height=300&width=300 "Wow it gets even better!!") of the demo, for testing purposes.

As a first approach, the service can render a geoJSON in a map, returning a PNG and you can determine also an optional height and width in pixels.

Parameters that can be used (can be passed to the app server as GET query params)

| Parameter | Description | Default Value |
| ---- | ---- | ---- |
| geojson | geojson object to be rendered in the map | `undefined` |
| height | height in pixels of the returned img | `600` |
| width | height in pixels of the returned img | `800` |
| center | center of the map lon,lat floats string | (center of the geojson) or `'-57.9524339,-34.921779'` |
| zoom | zoomlevel of the leaflet map | if `vectorserverUrl` available, use `12` else `20` |
| maxZoom | max zoomlevel of the leaflet map | `17` |
| attribution | attribution legend | `'osm-static-maps / © OpenStreetMap contributors'` |
| tileserverUrl | url of a tileserver | `'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'` |
| vectorserverUrl | url of a vector tile server (MVT style.json) | `undefined` |
| vectorserverToken | token of the vector tile server (MVT) | `'no-token'` |
| renderToHtml | returns html of the webpage containing the map (instead of a binary image) | `false` |
| type | format of the image returned (`'jpeg'`/`'png'`) | `'png'` |
| quality | quality of the image returned (`0`-`100`, only for `jpg`) | `100` |
| imagemin | enable lossless compression with [optipng](https://github.com/imagemin/imagemin-optipng) / [jpegtran](https://github.com/imagemin/imagemin-jpegtran) | `false` |
| oxipng | enable losslsess compression with [oxipng](https://github.com/shssoichiro/oxipng) | `false` |
| arrows | render arrows to show the direction of linestrings | `false` |

## How to use

1. This library is published in npm you can use it as an npm module

  ```
  -shell-
  npm install osm-static-maps

  -index.js-
  osmsm = require('osm-static-maps');
  osmsm({geojson: geojson})
    .then(function(imageBinaryBuffer) { ... })
    .catch(function(error) { ... })
  ```

2. alternatively you can download the code, run the sample server and use it standalone (see How to run)

3. lastly you can use the heroku-hosted alternative directly [here](http://osm-static-maps.herokuapp.com/ "Awesome!")

## How to run

nodejs is a prerequisite, please install it before this from here https://nodejs.org/
```
git clone git@github.com:jperelli/osm-static-maps.git
cd osm-static-maps
npm install
npm start
```

To develop with autoreload you can run directly if you have the required node version installed on the system

```
npm install && npm run dev
```

Or you can use docker-compose
```
docker-compose up
```

## Credits

Specially to the contributors of

- OpenStreetMap
- Leaflet
- Puppeteer
- ExpressJS
- Handlebars
