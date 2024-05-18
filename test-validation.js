const osmStaticMaps = require('./src/lib.js');

console.log('Starting test-validation script.');

const options = {
  // Providing a simple valid GeoJSON object for testing purposes
  geojson: JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Point',
        coordinates: [2.2943506, 48.8588443] // Coordinates for Eiffel Tower
      }
    }]
  }),
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
  timeout: 60000, // Updated timeout to match the evaluate function in lib.js
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
