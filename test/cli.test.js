import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

describe('osmsm serve', () => {
  it('shuts down with exit code 0 on SIGTERM', async () => {
    const port = 30000 + Math.floor(Math.random() * 10000);
    const child = spawn(process.execPath, [cli, 'serve', '-p', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    try {
      await new Promise((resolve, reject) => {
        child.stdout.on('data', () => { if (output.includes('listening')) resolve(); });
        child.on('exit', (code) => reject(new Error(`exited early (${code}):\n${output}`)));
      });

      const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
      const timeout = new Promise((resolve) => setTimeout(() => resolve('still running after 10s'), 10000));
      child.kill('SIGTERM');
      expect(await Promise.race([exited, timeout])).toEqual({ code: 0, signal: null });
    } finally {
      child.kill('SIGKILL');
    }
  });
});
