#!/usr/bin/env node

import { networkInterfaces } from "os";
import { createServer } from "http";
import { program } from "commander";
import osmsm, { warmupBrowser } from "./lib.js";
import { loadConfigFile, resolveOptions, unknownConfigKeys } from "./config.js";

function getLocalIp() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}
import packagejson from "../package.json" with { type: 'json' };

// Long option names of a command (the keys of `cmd.opts()`), excluding the
// options that cannot come from env vars or the config file.
function optionKeys(cmd) {
  return cmd.options
    .map((o) => o.attributeName())
    .filter((k) => !["version", "config"].includes(k));
}

// Splits `cmd.opts()` into what was explicitly passed on the command line
// and the built-in defaults, so env vars and the config file can sit between.
function splitCliOptions(cmd) {
  const cli = {};
  const defaults = {};
  for (const key of optionKeys(cmd)) {
    const value = cmd.getOptionValue(key);
    if (cmd.getOptionValueSource(key) === "cli") cli[key] = value;
    else defaults[key] = value;
  }
  return { cli, defaults };
}

function loadConfig(knownKeys) {
  const config = loadConfigFile({ configPath: program.opts().config });
  const unknown = unknownConfigKeys(config.values, knownKeys);
  if (unknown.length) {
    process.stderr.write(
      `Warning: ignoring unknown option(s) in ${config.path}: ${unknown.join(", ")}\n`
    );
  }
  return config;
}

function fail(message, code = 2) {
  process.stderr.write(message + "\n");
  process.exit(code);
}

const SERVE_OPTION_KEYS = ["port", "headerCheck", "headerCheckFailMessage"];

program
  .version(packagejson.version)
  .name("osmsm")
  .usage(
    "[options]\nGenerate an image of a geojson with a background map layer"
  )
  .option(
    "-C, --config <path>",
    "Config file (JSON) with default option values (default: ./osmsm.config.json or ~/.config/osmsm/config.json; env: OSMSM_CONFIG)"
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
    "Attribution legend watermark (default: \"osm-static-maps / © OpenStreetMap contributors\", or \"osm-static-maps\" when --vectorserverUrl is set)"
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
    "--no-vectorserverAttribution",
    "Hide the vector style's source attributions (show only --attribution)"
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
    "Enable render a scale ruler (see options in https://leafletjs.com/reference-1.9.4.html#control-scale-option)",
    false
  )
  .option(
    "-k, --markerIconOptions <json string>",
    "Set marker icon options (see doc in https://leafletjs.com/reference-1.9.4.html#icon-option)"
  )
  .option(
    "-T, --timeout <number>",
    "Miliseconds until page load throws timeout",
    Number,
    20000
  )
  .option(
    "-S, --style <json string>",
    "Set path style options (see doc in https://leafletjs.com/reference-1.9.4.html#path-option)"
  )
  .option(
    "-e, --haltOnConsoleError",
    "throw error if there is any console.error(...) when rendering the map image",
    false
  )
  .action(function(...args) {
    // commander passes the Command instance as the last action argument.
    const cmd = args[args.length - 1];
    let opts;
    try {
      const keys = optionKeys(cmd);
      const config = loadConfig([...keys, ...SERVE_OPTION_KEYS]);
      opts = resolveOptions({ keys, ...splitCliOptions(cmd), config: config.values }).values;
    } catch (e) {
      fail(e.message);
    }

    // DEBUG
    // process.stderr.write(JSON.stringify(opts, undefined, 2));
    // process.stderr.write("\n");

    if (!["png", "jpeg"].includes(opts.type)) {
      fail('-F|--type can only have the values "png" or "jpeg"');
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
  .description(
    "Start the http server. Render options given as env vars (OSMSM_*) or in the config file are used as defaults for every request"
  )
  .option("-p, --port <number>", "Port number to listen (env: OSMSM_PORT or PORT)", Number, 3000)
  .option(
    "--headerCheck <name:value>",
    "Reject with 403 the requests missing this header (env: OSMSM_HEADER_CHECK or HEADER_CHECK)"
  )
  .option(
    "--headerCheckFailMessage <string>",
    "Body of the 403 response when --headerCheck fails (env: OSMSM_HEADER_CHECK_FAIL_MESSAGE or HEADER_CHECK_FAIL_MESSAGE)"
  )
  .action(async function(...args) {
    const cmd = args[args.length - 1];
    const renderKeys = optionKeys(program);
    let opts;
    let renderDefaults;
    try {
      const config = loadConfig([...renderKeys, ...SERVE_OPTION_KEYS]);
      opts = resolveOptions({
        keys: SERVE_OPTION_KEYS,
        ...splitCliOptions(cmd),
        config: config.values,
      }).values;
      // Only env/config values: the lib applies its own built-in defaults.
      renderDefaults = resolveOptions({ keys: renderKeys, config: config.values }).values;
    } catch (e) {
      fail(e.message);
    }

    const { createApp } = await import("./server.js");
    const server = createServer(
      createApp({
        headerCheck: opts.headerCheck,
        headerCheckFailMessage: opts.headerCheckFailMessage,
        defaults: renderDefaults,
      })
    );
    // Launch chromium up front so the "Launching chromium" log appears at
    // startup (before request logs) and the first request isn't slowed by it.
    await warmupBrowser();
    server.listen(opts.port, function() {
      console.log("osmsm server listening on http://" + getLocalIp() + ":" + opts.port);
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
