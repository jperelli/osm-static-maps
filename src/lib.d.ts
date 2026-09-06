import { Control, IconOptions, PathOptions } from "leaflet";

export = _default;

interface OsmStaticMapsOptions {
  /**
   * Geojson object to be rendered in the map
   * @defaultValue `undefined`
   */
  geojson?: string | GeoJSON.GeoJSON;

  /**
   * Filename or url of a geojson to be rendered in the map ('-' to use stdin)
   * @defaultValue `undefined`
   */
  geojsonfile?: string;

  /**
   * height in pixels of the returned img
   * @defaultValue `600`
   */
  height?: number;

  /**
   * width in pixels of the returned img
   * @defaultValue `800`
   */
  width?: number;

  /**
   * center of the map lon,lat floats string
   * @defaultValue (center of the geojson) or `'-57.9524339,-34.921779'`
   */
  center?: string;

  /**
   * zoomlevel of the leaflet map
   * @defaultValue `maxZoom`
   */
  zoom?: number;

  /**
   * max zoomlevel of the leaflet map
   * @defaultValue `17`
   */
  maxZoom?: number;

  /**
   * attribution legend watermark
   * @defaultValue `'osm-static-maps / © OpenStreetMap contributors'`, or `'osm-static-maps'` when `vectorserverUrl` is set
   */
  attribution?: string;

  /**
   * url of a tileserver
   * @defaultValue `'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'`
   */
  tileserverUrl?: string;

  /**
   * url of a vector tile server (MVT style.json)
   * @defaultValue `undefined`
   */
  vectorserverUrl?: string;

  /**
   * token of the vector tile server (MVT). When set, it is sent as an
   * `Authorization: Bearer <token>` header on every map resource request
   * (via MapLibre's `transformRequest`).
   * @defaultValue `undefined`
   */
  vectorserverToken?: string;

  /**
   * show the vector style's source attributions (gathered from the style.json
   * sources) in addition to the `attribution` option. When `false`, only the
   * `attribution` option is shown.
   * @defaultValue `true`
   */
  vectorserverAttribution?: boolean;

  /**
   * returns html of the webpage containing the map (instead of a binary image)
   * @defaultValue `false`
   */
  renderToHtml?: boolean;

  /**
   * format of the image returned
   * @defaultValue `'png'`
   */
  type?: "jpeg" | "png";

  /**
   * quality of the image returned (`0`-`100`, only for `jpg`)
   * @defaultValue `100`
   */
  quality?: number;

  /**
   * enable lossless compression with [optipng](https://github.com/imagemin/imagemin-optipng) / [jpegtran](https://github.com/imagemin/imagemin-jpegtran)
   * @defaultValue `false`
   */
  imagemin?: boolean;

  /**
   * enable losslsess compression with [oxipng](https://github.com/shssoichiro/oxipng)
   * @defaultValue `false`
   */
  oxipng?: boolean;

  /**
   * render arrows to show the direction of linestrings
   * @defaultValue `false`
   */
  arrows?: boolean;

  /**
   * enable render a scale ruler (boolean or [a json options object](https://leafletjs.com/reference-1.9.4.html#control-scale-option)).
   * May also be passed as a pre-stringified JSON object.
   * @defaultValue `false`
   */
  scale?: boolean | Control.ScaleOptions | string;

  /**
   * set marker icon options ([a json options object](https://leafletjs.com/reference-1.9.4.html#icon-option)).
   * May also be passed as a pre-stringified JSON object.
   * @defaultValue `undefined`
   */
  markerIconOptions?: IconOptions | string;

  /**
   * miliseconds until page load throws timeout
   * @defaultValue `20000`
   */
  timeout?: number;

  /**
   * style to apply to each rendered feature ([a json options object](https://leafletjs.com/reference-1.9.4.html#path-option)).
   * Individual features may override it through their `pathOptions` property.
   * May also be passed as a pre-stringified JSON object.
   * @defaultValue `undefined`
   */
  style?: PathOptions | string;

  /**
   * throw error if there is any `console.error(...)` when rendering the map image
   *
   * @defaultValue `false`
   */
  haltOnConsoleError?: boolean;
}

interface CacheOptions {
  /**
   * maximum number of rendered images kept in memory (LRU eviction).
   * `0` keeps nothing in memory (only useful together with `dir`)
   * @defaultValue `100`
   */
  max?: number;

  /**
   * seconds until a cached image expires
   * @defaultValue `3600`
   */
  ttl?: number;

  /**
   * directory where cached images are also persisted, so they survive
   * restarts and can be shared between processes
   * @defaultValue `undefined` (memory only)
   */
  dir?: string;
}

interface RenderCache {
  /** number of images currently held in memory */
  readonly size: number;
  get(key: string): Promise<Buffer | undefined>;
  has(key: string): Promise<boolean>;
  set(key: string, image: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  /** drops every cached image (memory and, if configured, disk) */
  clear(): Promise<void>;
}

/** Renders a map controlled by the options passed and returns an image */
declare function _default<T extends OsmStaticMapsOptions>(
  options?: T
): Promise<T extends { renderToHtml: true } ? string : Buffer>;

declare namespace _default {
  /**
   * Closes the shared headless browser instance, if any. Useful for graceful
   * shutdown (e.g. serverless teardown or finishing a one-off script). A new
   * browser is launched automatically on the next render.
   */
  export function closeBrowser(): Promise<void>;

  /**
   * Enables caching of rendered images (keyed by their render options) for
   * every subsequent render in this process, replacing any previous cache.
   * Pass a falsy value to disable caching. Returns the active cache, if any.
   */
  export function configureCache(options?: CacheOptions | false | null): RenderCache | null;

  /** The cache enabled with `configureCache`, or `null` when caching is off */
  export function getCache(): RenderCache | null;

  /**
   * Key under which the image rendered with these options is (or would be)
   * cached. Options that don't affect the image (`timeout`,
   * `haltOnConsoleError`, `renderToHtml`) are ignored.
   */
  export function cacheKey(options?: OsmStaticMapsOptions): string;
}
