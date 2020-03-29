# 3.7.0

Add serve command to CLI

 - Add serve subcommand to CLI
 - Fix sample-server
 - Updated all dependencies to latest version

# 3.6.0

New CLI interface, puppeteer singleton

 - Add CLI interface
 - Fix sample server using too many resources, make headless browser singleton
 - Updated all dependencies to latest version
 - Refactored README
 - Refactored project directory structure

# 3.5.1

Fix geojson option

 - Fix geojson option being an object was not being parsed right and throwed an error

# 3.5.0

Add scale and marker icon options

 - Add scale parameter to render a scale ruler
 - Add marker icon options

# 3.4.1

Improve code reliability

 - Improved requirements' path resolution: use builtin require() function instead of relying in custom paths
 - Updated all dependencies to latest version
 - Fix center parameter issue in sample server

# 3.4.0

Add typescript definitions, allow POST in server

 - Add typescript definitions
 - Allow sample-server to use POST json enconded body to get the parameters
 - Allow library to be called without any arguments

# 3.3.0

Add arrows option on linestrings

 - Add `arrows` boolean option to show the direction of each linestring inside the geojson
 - Updated all dependencies to latest version
 - Improved nodemon to watch html template file
 - Remove annoying package-lock.json and pin all versions directly

# 3.2.0

Add optional lossless compresion

 - Add `imagemin` boolean option to lossless compress the result image using [imagemin](https://github.com/imagemin/imagemin) (optipng / jpegtran)
 - Add `oxipng` boolean option to lossless compress the result image using [oxipng](https://github.com/shssoichiro/oxipng) (only for png images) (searches in `/root/.cargo/bin/oxipng`, see how to install it in [Dockerfile](./Dockerfile))

# 3.1.1

Bugfixing

 - Fix bug wrong zooming when no geojson
 - Default to different zoom levels depending on vector vs raster tiles

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
