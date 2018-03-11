var express = require('express')
  , routes = require('./routes')
  , http = require('http')
  , path = require('path')
  , engines = require('consolidate');

var app = express();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'handlebars');
app.set("view options", { layout: false });
app.engine('.html', engines.handlebars);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/dynamic', routes.dynamic);
app.get('/', routes.index);

http.createServer(app).listen(app.get('port'), function(){
  console.log('Express server listening on port ' + app.get('port'));
});
