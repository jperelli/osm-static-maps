import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  envVarName,
  coerceValue,
  defaultConfigPaths,
  loadConfigFile,
  readEnvOptions,
  resolveOptions,
  unknownConfigKeys,
} from '../src/config.js';

// Unit tests for the CLI/server configuration layers (env vars + config
// file). Everything is driven through explicit `cwd`/`env` arguments so the
// tests never touch the real environment or home directory.

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'osmsm-config-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('envVarName', () => {
  it('maps camelCase option names to OSMSM_UPPER_SNAKE', () => {
    expect(envVarName('height')).toBe('OSMSM_HEIGHT');
    expect(envVarName('tileserverUrl')).toBe('OSMSM_TILESERVER_URL');
    expect(envVarName('maxZoom')).toBe('OSMSM_MAX_ZOOM');
    expect(envVarName('haltOnConsoleError')).toBe('OSMSM_HALT_ON_CONSOLE_ERROR');
    expect(envVarName('headerCheckFailMessage')).toBe('OSMSM_HEADER_CHECK_FAIL_MESSAGE');
  });
});

describe('coerceValue', () => {
  it('parses numbers for numeric options', () => {
    expect(coerceValue('height', '300')).toBe(300);
    expect(coerceValue('port', '8080')).toBe(8080);
    expect(() => coerceValue('width', 'wide')).toThrow(/Invalid number/);
    expect(() => coerceValue('width', '')).toThrow(/Invalid number/);
  });

  it('parses booleans for flag options', () => {
    expect(coerceValue('arrows', 'true')).toBe(true);
    expect(coerceValue('arrows', '1')).toBe(true);
    expect(coerceValue('arrows', 'false')).toBe(false);
    expect(coerceValue('vectorserverAttribution', '0')).toBe(false);
    expect(() => coerceValue('arrows', 'maybe')).toThrow(/Invalid boolean/);
  });

  it('accepts a boolean or a JSON object for scale', () => {
    expect(coerceValue('scale', 'true')).toBe(true);
    expect(coerceValue('scale', '{"metric":true}')).toBe('{"metric":true}');
  });

  it('leaves strings and already-typed values untouched', () => {
    expect(coerceValue('attribution', 'legend')).toBe('legend');
    expect(coerceValue('geojson', '{"type":"Point","coordinates":[1,2]}')).toBe(
      '{"type":"Point","coordinates":[1,2]}'
    );
    expect(coerceValue('height', 300)).toBe(300);
    expect(coerceValue('arrows', true)).toBe(true);
  });
});

describe('defaultConfigPaths', () => {
  it('looks in the cwd and then in the XDG config home', () => {
    const paths = defaultConfigPaths({ cwd: '/work', env: { XDG_CONFIG_HOME: '/xdg' } });
    expect(paths).toEqual([
      path.resolve('/work', 'osmsm.config.json'),
      path.join('/xdg', 'osmsm', 'config.json'),
    ]);
  });
});

describe('loadConfigFile', () => {
  it('returns an empty config when no file exists', () => {
    const cfg = loadConfigFile({ cwd: dir, env: { XDG_CONFIG_HOME: path.join(dir, 'xdg') } });
    expect(cfg).toEqual({ path: null, values: {} });
  });

  it('reads ./osmsm.config.json from the cwd', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"height": 300}');
    const cfg = loadConfigFile({ cwd: dir, env: {} });
    expect(cfg.path).toBe(path.join(dir, 'osmsm.config.json'));
    expect(cfg.values).toEqual({ height: 300 });
  });

  it('falls back to $XDG_CONFIG_HOME/osmsm/config.json', () => {
    const xdg = path.join(dir, 'xdg');
    mkdirSync(path.join(xdg, 'osmsm'), { recursive: true });
    writeFileSync(path.join(xdg, 'osmsm', 'config.json'), '{"width": 400}');
    const cfg = loadConfigFile({ cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    expect(cfg.path).toBe(path.join(xdg, 'osmsm', 'config.json'));
    expect(cfg.values).toEqual({ width: 400 });
  });

  it('prefers the cwd file over the user config file', () => {
    const xdg = path.join(dir, 'xdg');
    mkdirSync(path.join(xdg, 'osmsm'), { recursive: true });
    writeFileSync(path.join(xdg, 'osmsm', 'config.json'), '{"width": 400}');
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"width": 500}');
    const cfg = loadConfigFile({ cwd: dir, env: { XDG_CONFIG_HOME: xdg } });
    expect(cfg.values).toEqual({ width: 500 });
  });

  it('uses an explicit path (flag or $OSMSM_CONFIG) over the defaults', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"width": 500}');
    writeFileSync(path.join(dir, 'other.json'), '{"width": 600}');
    expect(loadConfigFile({ configPath: 'other.json', cwd: dir, env: {} }).values).toEqual({
      width: 600,
    });
    expect(
      loadConfigFile({ cwd: dir, env: { OSMSM_CONFIG: path.join(dir, 'other.json') } }).values
    ).toEqual({ width: 600 });
  });

  it('throws when an explicit path does not exist', () => {
    expect(() => loadConfigFile({ configPath: 'missing.json', cwd: dir, env: {} })).toThrow(
      /Config file not found/
    );
  });

  it('throws on invalid JSON or a non-object document', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{ not json');
    expect(() => loadConfigFile({ cwd: dir, env: {} })).toThrow(/Could not parse config file/);
    writeFileSync(path.join(dir, 'osmsm.config.json'), '[1, 2]');
    expect(() => loadConfigFile({ cwd: dir, env: {} })).toThrow(/must contain a JSON object/);
  });
});

describe('readEnvOptions', () => {
  it('reads OSMSM_* variables and coerces them', () => {
    const env = { OSMSM_HEIGHT: '300', OSMSM_ARROWS: 'true', OSMSM_ATTRIBUTION: 'x', OTHER: '1' };
    expect(readEnvOptions(['height', 'arrows', 'attribution', 'width'], env)).toEqual({
      height: 300,
      arrows: true,
      attribution: 'x',
    });
  });

  it('honours the legacy PORT / HEADER_CHECK variables, below OSMSM_*', () => {
    const keys = ['port', 'headerCheck', 'headerCheckFailMessage'];
    expect(
      readEnvOptions(keys, { PORT: '4000', HEADER_CHECK: 'x-key:s', HEADER_CHECK_FAIL_MESSAGE: 'no' })
    ).toEqual({ port: 4000, headerCheck: 'x-key:s', headerCheckFailMessage: 'no' });
    expect(readEnvOptions(keys, { PORT: '4000', OSMSM_PORT: '5000' })).toEqual({ port: 5000 });
  });

  it('ignores empty variables', () => {
    expect(readEnvOptions(['attribution'], { OSMSM_ATTRIBUTION: '' })).toEqual({});
  });
});

describe('resolveOptions', () => {
  const keys = ['height', 'width', 'attribution', 'arrows'];

  it('applies the precedence cli > env > config > defaults', () => {
    const { values, sources } = resolveOptions({
      keys,
      cli: { height: 100 },
      env: { OSMSM_HEIGHT: '200', OSMSM_WIDTH: '250' },
      config: { height: 300, width: 350, attribution: 'cfg' },
      defaults: { height: 600, width: 800, attribution: undefined, arrows: false },
    });
    expect(values).toEqual({ height: 100, width: 250, attribution: 'cfg', arrows: false });
    expect(sources).toEqual({ height: 'cli', width: 'env', attribution: 'config', arrows: 'default' });
  });

  it('coerces string values coming from the config file', () => {
    const { values } = resolveOptions({ keys, env: {}, config: { height: '300', arrows: 'true' } });
    expect(values).toEqual({ height: 300, arrows: true });
  });

  it('only returns the keys asked for', () => {
    const { values } = resolveOptions({
      keys: ['height'],
      env: { OSMSM_WIDTH: '1' },
      config: { attribution: 'cfg', port: 1 },
    });
    expect(values).toEqual({});
  });
});

describe('unknownConfigKeys', () => {
  it('lists the config keys that are not known options', () => {
    expect(unknownConfigKeys({ height: 1, typo: 2 }, ['height', 'width'])).toEqual(['typo']);
  });
});
