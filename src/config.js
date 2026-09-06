// Configuration layers for the CLI and the `osmsm serve` server.
//
// Precedence (highest first): CLI flags > env vars (OSMSM_*) > legacy env
// vars (PORT, HEADER_CHECK, ...) > config file > built-in defaults.
//
// This module is intentionally not used by the library (src/lib.js): passing
// explicit options to the lib must keep working regardless of the environment.

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import path from "path";

export const ENV_PREFIX = "OSMSM_";
export const CONFIG_FILE_ENV = "OSMSM_CONFIG";
export const CONFIG_FILE_NAME = "osmsm.config.json";

// Options whose values need coercion when they come from strings (env vars
// or a config file written with quoted values).
const NUMBER_OPTIONS = new Set([
  "height",
  "width",
  "zoom",
  "maxZoom",
  "quality",
  "timeout",
  "port",
]);
const BOOLEAN_OPTIONS = new Set([
  "vectorserverAttribution",
  "renderToHtml",
  "imagemin",
  "oxipng",
  "arrows",
  "haltOnConsoleError",
]);
// `scale` accepts a boolean or a JSON options object.
const BOOLEAN_OR_JSON_OPTIONS = new Set(["scale"]);

// Unprefixed env vars honoured by `osmsm serve` since before OSMSM_* existed.
export const LEGACY_ENV_VARS = {
  port: "PORT",
  headerCheck: "HEADER_CHECK",
  headerCheckFailMessage: "HEADER_CHECK_FAIL_MESSAGE",
};

/** `tileserverUrl` -> `OSMSM_TILESERVER_URL` */
export function envVarName(option) {
  return ENV_PREFIX + option.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/** Paths searched, in order, when no explicit config file is given. */
export function defaultConfigPaths({ cwd = process.cwd(), env = process.env } = {}) {
  const configHome = env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return [
    path.resolve(cwd, CONFIG_FILE_NAME),
    path.join(configHome, "osmsm", "config.json"),
  ];
}

function parseConfigFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Could not parse config file ${file}: ${e.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file ${file} must contain a JSON object`);
  }
  return parsed;
}

/**
 * Loads the config file. An explicit path (`--config` or `$OSMSM_CONFIG`)
 * must exist; otherwise the first existing default path is used, and none
 * existing is not an error.
 * @returns {{ path: string | null, values: object }}
 */
export function loadConfigFile({ configPath, cwd, env = process.env } = {}) {
  const explicit = configPath || env[CONFIG_FILE_ENV];
  if (explicit) {
    const file = path.resolve(cwd || process.cwd(), explicit);
    if (!existsSync(file)) {
      throw new Error(`Config file not found: ${file}`);
    }
    return { path: file, values: parseConfigFile(file) };
  }
  for (const file of defaultConfigPaths({ cwd, env })) {
    if (existsSync(file)) {
      return { path: file, values: parseConfigFile(file) };
    }
  }
  return { path: null, values: {} };
}

function parseBoolean(option, raw) {
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off", ""].includes(v)) return false;
  throw new Error(`Invalid boolean value for option '${option}': ${raw}`);
}

/** Coerces a string value to the type expected by `option`. */
export function coerceValue(option, value) {
  if (typeof value !== "string") return value;
  if (NUMBER_OPTIONS.has(option)) {
    const n = Number(value);
    if (value.trim() === "" || Number.isNaN(n)) {
      throw new Error(`Invalid number value for option '${option}': ${value}`);
    }
    return n;
  }
  if (BOOLEAN_OPTIONS.has(option)) return parseBoolean(option, value);
  if (BOOLEAN_OR_JSON_OPTIONS.has(option)) {
    const v = value.trim();
    if (v.startsWith("{")) return v;
    return parseBoolean(option, value);
  }
  return value;
}

/** Reads `OSMSM_*` (and legacy) env vars for the given option names. */
export function readEnvOptions(keys, env = process.env) {
  const values = {};
  for (const key of keys) {
    const prefixed = env[envVarName(key)];
    const legacy = LEGACY_ENV_VARS[key] && env[LEGACY_ENV_VARS[key]];
    const raw = prefixed !== undefined ? prefixed : legacy;
    if (raw !== undefined && raw !== "") {
      values[key] = coerceValue(key, raw);
    }
  }
  return values;
}

/**
 * Merges the configuration layers for `keys`.
 * `cli` must only contain options explicitly passed on the command line.
 * @returns {{ values: object, sources: Record<string, 'cli'|'env'|'config'|'default'> }}
 */
export function resolveOptions({ keys, cli = {}, env = process.env, config = {}, defaults = {} }) {
  const envValues = readEnvOptions(keys, env);
  const values = {};
  const sources = {};
  for (const key of keys) {
    if (cli[key] !== undefined) {
      values[key] = cli[key];
      sources[key] = "cli";
    } else if (envValues[key] !== undefined) {
      values[key] = envValues[key];
      sources[key] = "env";
    } else if (config[key] !== undefined) {
      values[key] = coerceValue(key, config[key]);
      sources[key] = "config";
    } else if (defaults[key] !== undefined) {
      values[key] = defaults[key];
      sources[key] = "default";
    }
  }
  return { values, sources };
}

/** Option names present in `config` that are not in `knownKeys`. */
export function unknownConfigKeys(config, knownKeys) {
  const known = new Set(knownKeys);
  return Object.keys(config).filter((k) => !known.has(k));
}
