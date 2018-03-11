var webshot = require('webshot');
var fs = require('fs');
var Handlebars = require('handlebars');

// TEST: won't work! http://localhost:5000/dynamic?geojson={%22type%22:%20%22Point%22,%22coordinates%22:[-105.01621,39.57422]}

function makeContext(req) {
    var context = {
        lat    : -34.921779,
        lon    : -57.9524339,
        zoom   : 12,
        geojson: "",
    }
    if (req.query.geojson)
        context.geojson = req.query.geojson
    return context
}

exports.index = function(req, res){
    console.log(req.query)
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {var r = Math.random()*16|0,v=c=='x'?r:r&0x3|0x8;return v.toString(16);});
    fs.readFile('views/dynamic.html', 'utf8', function (err,data) {
        if (err) {
            return res.end(err);
        }
        else {
            var template = Handlebars.compile(data);
            var html = "";
            try {
                html = template(makeContext(req));
            }
            catch(e) {
                console.log(e)
            }
            
            var height = 600
            var width  = 800
            
            if (req.query.height)
                height = req.query.height
            if (req.query.width)
                width  = req.query.width
            
            webshot(html, {siteType:'html', takeShotOnCallback: true, windowSize:{ width: width, height: height }, timeout:15000}, function(err, renderStream) {
                if (!err) {
                    renderStream.on('data', function(data) {
                        res.write(data.toString('binary'), 'binary');
                    });
                    renderStream.on('end', function(data){
                        res.end(data);
                    });
                }
                else
                    res.send(err + ". Perhaps there is an error in your parameters?")
            });
        }
    });

};

exports.dynamic = function(req, res){
    var context = makeContext(req)
    res.render('dynamic.html', context);
};