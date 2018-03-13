var express = require('express')
  , http = require('http')
  , path = require('path')
  , engines = require('consolidate')
  , osmsm = require('./lib/lib.js');

var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/lib');
app.set('view engine', 'handlebars');
app.set("view options", { layout: false });
app.engine('.html', engines.handlebars);

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});


// TEST: won't work! http://localhost:5000/dynamic?geojson={%22type%22:%20%22Point%22,%22coordinates%22:[-105.01621,39.57422]}

function makeContext(req) {
    var context = {
        lat    : -34.921779,
        lng    : -57.9524339,
        zoom   : 12,
        geojson: "",
    }
    if (req.query.geojson)
        context.geojson = req.query.geojson
    return context
}


app.get('/', function(req, res) {
  var height
  var width
  
  if (req.query.height)
      height = req.query.height
  if (req.query.width)
      width  = req.query.width

  var context = makeContext(req)

  osmsm({
    height: height,
    width: width,
    lat: context.lat,
    lng: context.lng,
    zoom: context.zoom,
    geojson: context.geojson,
    // 'http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    tileserverUrl: 'http://korona.geog.uni-heidelberg.de/tiles/roads/x={x}&y={y}&z={z}'
  }).then(function(stream) {
    stream.on('data', function(data) {
      res.write(data.toString('binary'), 'binary');
    });
    stream.on('end', function(data){
      res.end(data);
    });
  }).catch(function(err) {
    res.end(". Perhaps there is an error in your parameters?");
  })

});


app.get('/dynamic', function(req, res) {
    var context = makeContext(req)
    res.render('template.html', context);
});
