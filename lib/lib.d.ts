import { Control } from "leaflet";

export = _default;

interface OsmStaticMapsOptions {
  /**
   * Geojson object to be rendered in the map
   * @defaultValue `undefined`
   */
  geojson?: string;

  /**
   * height in pixels of the returned img
   * @defaultValue `600`
   */
  height?: number;

  /**
   * height in pixels of the returned img
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
   * @defaultValue `vectorserverUrl` ? `12` : `20`
   */
  zoom?: number;

  /**
   * max zoomlevel of the leaflet map
   * @defaultValue `17`
   */
  maxZoom?: number;

  /**
   * attribution legend
   * @defaultValue `'osm-static-maps / © OpenStreetMap contributors'`
   */
  attribution?: string;

  /**
   * url of a tileserver
   * @defaultValue `'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'`
   */
  tileserverUrl?: string;

  /**
   * url of a vector tile server (MVT style.json)
   * @defaultValue `undefined`
   */
  vectorserverUrl?: string;

  /**
   * token of the vector tile server (MVT)
   * @defaultValue `'no-token'`
   */
  vectorserverToken?: string;

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
   * enable render a scale ruler (boolean or [a json options object](https://leafletjs.com/reference-1.6.0.html#control-scale-option))
   * @defaultValue `false`
   */
  scale?: boolean | Control.ScaleOptions;
}

/** Renders a map controlled by the options passed and returns an image */
function _default<T extends OsmStaticMapsOptions>(
  options?: T
): Promise<T extends { renderToHtml: true } ? string : Buffer>;
