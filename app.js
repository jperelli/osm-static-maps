var express = require('express')
  , routes = require('./routes')
  , http = require('http')
  , path = require('path')
  , engines = require('consolidate')
  , fs = require('fs')
  , Handlebars = require('handlebars');

var app = express();

fs.readFile('node_modules/leaflet/dist/leaflet.js', function(err, data) {
  Handlebars.registerPartial('leafletjs', data.toString())
})
fs.readFile('node_modules/leaflet/dist/leaflet.css', function(err, data) {
  Handlebars.registerPartial('leafletcss', data.toString())
})

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'handlebars');
app.set("view options", { layout: false });
app.engine('.html', engines.handlebars);
app.use(express.static(path.join(__dirname, 'public')));
app.use('/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist')))

app.get('/dynamic', routes.dynamic);
app.get('/', routes.index);

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
