#!/usr/bin/env node

import { program } from "commander";
import osmsm from "./lib.js";
import packagejson from "../package.json" with { type: 'json' };

program
  .version(packagejson.version)
  .name("osmsm")
  .usage(
    "[options]\nGenerate an image of a geojson with a background map layer"
  )
  .option("-g, --geojson <string>", "Geojson object to be rendered")
  .option("-f, --geojsonfile <string>", "Geojson file name to be rendered (\"-\" reads STDIN)")
  .option(
    "-H, --height <number>",
    "Height in pixels of the returned img",
    Number,
    600
  )
  .option(
    "-W, --width <number>",
    "Width in pixels of the returned img",
    Number,
    800
  )
  .option(
    "-c, --center <lon,lat>",
    "Center of the map (default: center of geojson or '-57.9524339,-34.921779'"
  )
  .option(
    "-z, --zoom <number>",
    "Zoomlevel of the map (default: maxZoom)",
    Number
  )
  .option("-Z, --maxZoom <number>", "Maximum zoomlevel of the map", Number, 17)
  .option(
    "-A, --attribution <string>",
    "Attribution legend watermark",
    "osm-static-maps / © OpenStreetMap contributors"
  )
  .option(
    "-t, --tileserverUrl <string>",
    "Url of a tileserver",
    "http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  )
  .option(
    "-m, --vectorserverUrl <string>",
    "Url of a vector tile server (MVT style.json)"
  )
  .option(
    "-M, --vectorserverToken <string>",
    "Token of the vector tile server (MVT)"
  )
  .option(
    "-D, --renderToHtml",
    "Returns html of the webpage containing the leaflet map (instead of a binary image)",
    false
  )
  .option("-F, --type <jpeg|png>", "Format of the image returned", "png")
  .option(
    "-q, --quality <number>",
    "Quality of the image returned (only for -F=jpeg)",
    Number,
    100
  )
  .option(
    "-x, --imagemin",
    "Apply lossless compression with optipng/jpegtran",
    false
  )
  .option("-X, --oxipng", "Apply lossless compression with oxipng", false)
  .option(
    "-a, --arrows",
    "Render arrows to show the direction of linestrings",
    false
  )
  .option(
    "-s, --scale [json string]",
    "Enable render a scale ruler (see options in https://leafletjs.com/reference-1.6.0.html#control-scale-option)",
    false
  )
  .option(
    "-k, --markerIconOptions <json string>",
    "Set marker icon options (see doc in https://leafletjs.com/reference-1.6.0.html#icon-option)"
  )
  .option(
    "-T, --timeout <number>",
    "Miliseconds until page load throws timeout",
    Number,
    20000
  )
  .option(
    "-S, --style <json string>",
    "Set path style options (see doc in https://leafletjs.com/reference-1.6.0.html#path-option)"
  )
  .option(
    "-e, --haltOnConsoleError",
    "throw error if there is any console.error(...) when rendering the map image",
    false
  )
  .action(function(cmd) {
    const opts = cmd.opts();

    // DEBUG
    // process.stderr.write(JSON.stringify(opts, undefined, 2));
    // process.stderr.write("\n");

    if (!["png", "jpeg"].includes(opts.type)) {
      process.stderr.write(
        '-F|--type can only have the values "png" or "jpeg"\n'
      );
      process.exit(2);
    }

    osmsm(opts)
      .then(v => {
        process.stdout.write(v);
        process.stdout.end();
        process.exit(0);
      })
      .catch(e => {
        process.stderr.write(e.toString());
        process.exit(1);
      });
  });

program
  .command("serve")
  .option("-p, --port <number>", "Port number to listen")
  .action(async function(cmd) {
    const server = (await import("./server.js")).default;
    const port = cmd.port || process.env.PORT || 3000;
    server.listen(port, function() {
      console.log("osmsm server listening on port " + port);
    });
  });

program.on("--help", function() {
  process.stdout.write("\n");
  process.stdout.write("Examples: \n");
  process.stdout.write(
    `  $ osmsm -g '{"type":"Point","coordinates":[-105.01621,39.57422]}'\n`
  );
  process.stdout.write(
    `  $ osmsm -g '[{"type":"Feature","properties":{"party":"Republican"},"geometry":{"type":"Polygon","coordinates":[[[-104.05,48.99],[-97.22,48.98],[-96.58,45.94],[-104.03,45.94],[-104.05,48.99]]]}},{"type":"Feature","properties":{"party":"Democrat"},"geometry":{"type":"Polygon","coordinates":[[[-109.05,41.00],[-102.06,40.99],[-102.03,36.99],[-109.04,36.99],[-109.05,41.00]]]}}]' --height=300 --width=300\n`
  );
  process.stdout.write(
    `  $ osmsm -f /path/to/my_file.json\n`
  );
  process.stdout.write(
    `  $ program_with_geojson_on_stdout | osmsm -f -\n`
  );
  process.stdout.write("\n");
});

program.parse(process.argv);
