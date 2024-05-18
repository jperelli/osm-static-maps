const osmStaticMaps = require('./src/lib.js');

console.log('Starting test-validation script.');

const options = {
  geojson: JSON.stringify({ type: 'FeatureCollection', features: [] }),
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

console.log('Options object created:', options);

osmStaticMaps(options)
  .then(result => {
    console.log('osmStaticMaps function executed successfully.');
    console.log('Result:', result);
  })
  .catch(error => {
    console.error('Error caught in test-validation script:');
    console.error(error);
  });

console.log('test-validation script finished.');
