# 6.0.1

 - Fix renders that came back without the background map (the light-blue leaflet container with only the geojson overlays and the attribution on it): about 2-7% of the `vectorserverUrl` renders on a loaded host, more the busier the host. Cause: the screenshot was taken with puppeteer's `fullPage: true`, which makes chromium capture "beyond the viewport" by temporarily overriding the device metrics while capturing. That resizes the page under the map: leaflet-maplibre shrinks its container to ~1px and grows it back, maplibre's `ResizeObserver` reacts to each with `canvas.width = ...`, which clears the WebGL canvas, and the redraw only comes with the next animation frame. On an idle host the redraw lands before the pixels are read; on a loaded host the capture often got the cleared canvas. The viewport already has the requested `width` x `height`, so the image is now a plain viewport screenshot (`captureBeyondViewport: false`), which never touches the page's size. Measured locally with 8 concurrent OpenFreeMap renders: 7-13% blank -> 0/200, median render ~950 ms -> ~750 ms (no device metrics round trip)
 - New test: concurrent vector renders (fresh and reused pages) under CPU starvation must all show the style's background

# 6.0.0

 - Warm pages are reused between renders: a page that already parsed leaflet/maplibre and loaded the background layer is kept (up to 4 idle pages, closed and rebuilt after 100 renders; both configurable with `configureBrowser({ maxIdlePages, maxRendersPerPage })`, `serve --max-idle-pages/--max-renders-per-page` or `OSMSM_MAX_IDLE_PAGES`/`OSMSM_MAX_RENDERS_PER_PAGE`) and the next render with the same size, `maxZoom`, tile/vector server, token, style attribution and marker icon only swaps the overlays and the view inside it (`window.renderMap(params)` in the template) instead of building a new page. Measured locally with the OpenFreeMap style, 880x300: a repeated or neighbouring route ~0.7 s -> ~0.1-0.2 s; a route in an area whose tiles are not loaded yet is still bound by the tile download. The output is pixel-identical to a fresh page (the view is applied with leaflet's `reset: true` so the pixel origin does not depend on the previous view). A page whose render failed is closed, not reused
 - New option `isolated` (`-i, --isolated` / `isolated: true` / `?isolated=true`, default `false`): render in a fresh page that is closed afterwards, i.e. the previous behaviour. `osmsm serve --isolated` makes it the default for every request
 - Chromium is launched in `headless: 'shell'` mode (puppeteer's `chrome-headless-shell` build, ~20% faster warm render than the full browser; falls back to the regular binary when the shell build is not installed)
 - The one-shot CLI launches chromium with `--single-process` (~40% faster warm render, no process isolation needed for a single render). `serve` and the library never set it; `configureBrowser({ singleProcess, isolated })` exposes both process-wide defaults, `browserStats()` the number of idle/busy pages
 - Rejected (instead of a timeout) when the `geojson` is not valid JSON; the geojson is embedded with `<` escaped so it cannot close the template's `<script>`

# 5.2.1

 - Same tile cache as 5.2.0 (chromium's own HTTP cache) without the loopback page server: the page is loaded with `page.setContent()` again and chromium is launched with `--disable-features=SplitCacheByNetworkIsolationKey`. Chromium partitions its HTTP cache by top-frame origin and never caches for the opaque about:blank origin a `setContent()` page has; with the partitioning disabled the cache applies to it like to any other page. Same measured effect (repeated/neighbouring OpenFreeMap render ~2.4 s -> ~0.5 s, 0 tile requests), no extra server, no temp files, no interception
 - `closeBrowser()` is back to only closing the browser

# 5.2.0

 - Tiles, glyphs and sprites are cached again between renders, this time by chromium's own HTTP cache: the rendered page is now served to the browser from a loopback HTTP server (`http://127.0.0.1:<random port>/<uuid>.html`) instead of `page.setContent()`. `setContent()` gives the page an opaque origin, for which chromium never reuses its HTTP cache, so every render re-downloaded everything. The cache honours the tile server's `Cache-Control`/`max-age`, is shared by all pages of the browser singleton (so it works for the whole life of `osmsm serve`), and involves no request interception, so it cannot stall a request like the cache removed in 5.1.1 did. Measured on OpenFreeMap vector tiles: a repeated or neighbouring render drops from ~2.4 s to ~0.5 s and makes 0 tile requests
 - `closeBrowser()` also shuts the loopback page server down

# 5.1.1

 - Remove the puppeteer request-interception tile cache (`setRequestInterception` + `request.continue()`). On a loaded production host it left 1-2 MapLibre tile fetches paused forever, so every `vectorserverUrl` render ended in `TimeoutError: Waiting failed` while raster renders worked; without interception the same render finishes in a few seconds. The cache could not have been doing much anyway: pages are loaded with `setContent` (opaque origin), so Chrome's own HTTP cache does not apply either

# 5.1.0

 - Add `webp` as an output format (`type: 'webp'` / `-F webp` / `?type=webp`), served with `Content-Type: image/webp`
 - `quality` (`0`-`100`) now applies to both `jpeg` and `webp`; `quality: 0` is no longer silently replaced by `100`
 - Accept `jpg` as an alias of `jpeg`
 - Validate `type` and `quality` in the library (server now answers `400` instead of `500` for them)
 - `imagemin`/`oxipng` are skipped for formats they cannot handle (`webp`, and `jpeg` for oxipng) instead of corrupting or failing the output

# 5.0.0

Modernize package with multiple improvements

### Major

 - **Breaking**: Require Node `>=22.12.0` (was `>=12`). The code already relied on features unavailable in older Node versions (top-level await, `import.meta.resolve`, JSON import attributes), and `commander@15` requires Node `>=22.12.0`, so it could not run on older versions. `engines.node` now reflects this.
 - **Breaking**: `vectorserverToken` no longer defaults to `'no-token'` (now `undefined`) and is sent as an `Authorization: Bearer <token>` header (via MapLibre's `transformRequest`) only when provided
 - **Breaking**: Improve binary resolution with cross-platform path fallbacks for the browser (Chrome/Chromium/Edge/Brave) and for `oxipng`/`jpegtran`
 - Bump Docker image and add asdf `.tool-versions` to latest Node `26.3.1`
 - Migrate vector tile rendering from the unmaintained `mapbox-gl` to the fully open source `maplibre-gl`. 
 - Add `vectorserverAttribution` option (default `true`) to control appending the vector style's source attributions
 - Upgrade Express from `4.x` to `5.x`. The server only uses simple string routes and APIs unaffected by the v5 removals; note Express 5 defaults to the "simple" query parser, so bracket/array query params (`?arr[]=1`) are no longer parsed into arrays (osmsm uses flat query params only)
 - Upgrade `puppeteer`/`puppeteer-core` from `23.x` to `25.x`, adapting to their breaking changes: `ignoreHTTPSErrors` launch option renamed to `acceptInsecureCerts` (removed in v24), `Browser.isConnected()` method replaced with the `browser.connected` property (removed in v25), and `executablePath()` now returning a `Promise` (v25). v25 is ESM-only and requires Node `>=22`, both already satisfied
 - Update dependencies to latest available

### Minor Fixes

 - Fix `npx osmsm` (incl. `--help`) doing nothing: the browser is now loaded lazily so the CLI no longer requires a browser package just to start, and the `osmsm` alias pins `osm-static-maps@^5.0.0`
 - Fix the CLI render command crashing with `cmd.opts is not a function` (regression from the commander v12 upgrade; the action now reads options from the Command instance)
 - When using `puppeteer-core` (e.g. via `npx`), auto-discover a system Chrome/Chromium/Edge/Brave binary across common OS paths, honoring `PUPPETEER_EXECUTABLE_PATH`; if none is found, error with the list of paths tried
 - Make `imagemin`/`imagemin-jpegtran`/`imagemin-optipng` optional dependencies so a failed native build (jpegtran/optipng) no longer aborts install; `--imagemin` now errors clearly if they are missing
 - `--oxipng` now resolves the `oxipng` binary across common locations (honoring an `OXIPNG_PATH` override) instead of a single hardcoded path, and reports a clear error when it cannot be found
 - Fix `timeout` default never applying
 - Set `Content-Type` header on server responses so images render inline instead of downloading
 - Fix import of chromium on the Vercel/Lambda platform
 - Improve Error rejections so that stack traces are not lost
 - Always resolve with a `Buffer` (puppeteer now returns a `Uint8Array`), matching the documented `Promise<Buffer>` return type

### Internal Quality

 - add a `ci.yml` workflow that smoke-tests the lib and CLI on Node 20/22/24/26
 - Add a test suite (vitest): template/option tests plus hermetic image-render integration tests; run with `npm test`
 - Fix and complete the TypeScript definitions
 - Add `closeBrowser()` named export to gracefully shut down the shared headless browser
 - Upgrade links to leaflet latest docs
 - Upgrade to correct GPL license version
 - Add an `osmsm` alias package so the CLI can be run directly with `npx osmsm`
 - Add a `files` whitelist so the published package ships only runtime sources

# 4.0.2

Fix vector map labels

 - Fix vector map labels not being rendered with 100% opacity

# 4.0.1

Fix vectorserverUrl

 - Fix vectorserverUrl option was never returning the image
 - Change equal default zoom for vector and raster tiles 

# 4.0.0

Change commonjs to nodejs modules

 - **Breaking**: Change commonjs to nodejs modules
 - Upgrade all dependencies to latest versions
 - Fix imagemin missing binary
 - Change oxipng compression to level 0

# 3.11.2

Improve docker files

 - Add prod config without volumes and autoreload

# 3.11.1

Better dependencies pinning

 - Uningnored package-lock.json to better pin dependencies

# 3.11.0

Improve speed

 - Speed up results:
    - Add cache to resolve faster tilesets in sample-server
    - Correct default tile url to use https to avoid redirection
    - Remove unnecessary network wait. Change it to wait for map load event
    - Remove tile fade-in effect to be able to resolve earlier
 - Upgrade all dependencies to latest versions
 - Removed not-working heroku demo
 - Removed validation that broke the /dynamic endpoint

# 3.10.3

Support AWS functions hotfix

 - Move dependencies right.

# 3.10.2

Support AWS functions

 - Move dependencies to dev to conform the 50Mib limit

# 3.10.1

Hotfix

 - Fix broken local puppeteer

# 3.10.0

Add support to vercel api functions

 - Use chrome-aws-lambda as alternative to base puppeteer

# 3.9.1

Maintenance

 - Upgrade dependencies to latest versions

# 3.9.0

Read geojson from file or stdin

 - Add new option `-f` to read geojson from file, stdin (`-`) or url
 - Fix issue on console error misses, add `haltOnConsoleError` option
 - Prevent HTML/JS injection vulnerability in sample server
 - Upgrade dependencies

# 3.8.1

Maintenance

 - Upgrade dependencies, outstandingly puppeteer from 3.x to 5.x
 - Improve sample-server logging client information

# 3.8.0

Add styling options to features

 - Add per feature and global style configuration option
 - Add timeout option
 - Add Dockerfile kanji font support
 - Add geojson typescript type
 - Fix arrows argument crashing lib
 - Update all dependencies to the latest version

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
