const osmStaticMaps = require('./src/lib.js');

const options = {
  geojson: { type: 'FeatureCollection', features: [] },
  height: 600,
  width: 800,
  center: '48.8588443,2.2943506',
  zoom: 10,
  maxZoom: 17,
  attribution: 'osm-static-maps | © OpenStreetMap contributors',
  tileserverUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  vectorserverUrl: '',
  vectorserverToken: 'validString',
  imagemin: false,
  oxipng: false,
  arrows: false,
  scale: false,
  markerIconOptions: {},
  style: {},
  timeout: 20000,
  haltOnConsoleError: false
};

osmStaticMaps(options).then(console.log).catch(console.error);
