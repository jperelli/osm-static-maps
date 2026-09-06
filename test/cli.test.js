import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, openSync, closeSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// End-to-end tests of the CLI configuration layers. They render to HTML
// (`-D`) so no headless browser is needed, and capture stdout through a file
// because the CLI exits right after writing (a pipe would be cut at 64KB).

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'osmsm-cli-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function runCli(args, { env = {}, cwd = dir } = {}) {
  const out = path.join(dir, `stdout-${Math.random().toString(36).slice(2)}`);
  const fd = openSync(out, 'w');
  // Isolate from the user's own config file and environment.
  const cleanEnv = { PATH: process.env.PATH, XDG_CONFIG_HOME: path.join(dir, 'no-xdg'), ...env };
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: cleanEnv,
    stdio: ['ignore', fd, 'pipe'],
    encoding: 'utf8',
  });
  closeSync(fd);
  return { status: res.status, stdout: readFileSync(out, 'utf8'), stderr: res.stderr };
}

describe('osmsm CLI configuration', () => {
  it('uses the built-in defaults when nothing is configured', () => {
    const { status, stdout } = runCli(['-D']);
    expect(status).toBe(0);
    expect(stdout).toContain('© OpenStreetMap contributors');
  });

  it('reads options from OSMSM_* env vars', () => {
    const { status, stdout } = runCli(['-D'], { env: { OSMSM_ATTRIBUTION: 'from env' } });
    expect(status).toBe(0);
    expect(stdout).toContain('from env');
  });

  it('reads options from ./osmsm.config.json in the cwd', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"attribution": "from file"}');
    const { status, stdout } = runCli(['-D']);
    expect(status).toBe(0);
    expect(stdout).toContain('from file');
  });

  it('applies the precedence cli > env > config file', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"attribution": "from file"}');
    const env = { OSMSM_ATTRIBUTION: 'from env' };

    expect(runCli(['-D'], { env }).stdout).toContain('from env');
    expect(runCli(['-D', '-A', 'from cli'], { env }).stdout).toContain('from cli');
  });

  it('accepts an explicit config file via --config and $OSMSM_CONFIG', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"attribution": "from cwd file"}');
    const other = path.join(dir, 'other.json');
    writeFileSync(other, '{"attribution": "from other file"}');

    expect(runCli(['-D', '--config', other]).stdout).toContain('from other file');
    expect(runCli(['-D'], { env: { OSMSM_CONFIG: other } }).stdout).toContain('from other file');
  });

  it('fails with a clear error when the explicit config file is missing', () => {
    const { status, stderr } = runCli(['-D', '--config', 'missing.json']);
    expect(status).toBe(2);
    expect(stderr).toContain('Config file not found');
  });

  it('fails with a clear error on an invalid env var value', () => {
    const { status, stderr } = runCli(['-D'], { env: { OSMSM_HEIGHT: 'tall' } });
    expect(status).toBe(2);
    expect(stderr).toContain("Invalid number value for option 'height'");
  });

  it('warns about unknown keys in the config file but still renders', () => {
    writeFileSync(path.join(dir, 'osmsm.config.json'), '{"attribution": "ok", "typo": 1}');
    const { status, stdout, stderr } = runCli(['-D']);
    expect(status).toBe(0);
    expect(stdout).toContain('ok');
    expect(stderr).toContain('ignoring unknown option(s)');
    expect(stderr).toContain('typo');
  });
});
