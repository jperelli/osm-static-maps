# 3.1.0

Add mapbox vector tiles and expose more options

 - Add CHANGELOG file to track version changes
 - Add `vectorserverUrl` and `vectorserverToken` options for taking a screenshot using Mapbox Vector Tiles (MVT) Layer (style.json)
 - Expose `center` option
 - Expose `zoom` and`maxZoom` options
 - Expose `attribution` option to set the legend / copyright
 - Expose `renderToHtml` option
 - Expose `type` and `quality` to control returned image format

# 3.0.0

Upgrade packages and improve speed

 - Replace unmaintained node-webshot with puppeteer
 - Upgrade all dependencies, including leaflet
 - Fix bug geojson `Point`s were not being rendered
 - Add docker-compose support
 - Upgrade heroku config to latest CEDAR stack

# 2.1.0

Add options

 - Add `tileserverUrl` option
 - Add Dockerfile

# 2.0.0

Make it reusable as a library

- Refactored to be a npm library
- Publish package in npm
- Started using semver

# 1.0.0

Improve reliability for a stable release

- Serve leaflet locally instead of using a cdn
- Upgrade packages to latest versions
- Improve readme

# 0.0.1

Initial useful version.

- Express application that takes a screenshot of a geojson over a leafletmap with parameters `geojson`, `height`, `width`
- Published in heroku
