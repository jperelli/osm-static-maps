import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'http';
import { createApp } from '../src/server.js';

// Tests for the server settings (`createApp`), as wired by `osmsm serve`.
// Requests ask for HTML so no headless browser is needed.

let server;

async function listen(app) {
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  return `http://localhost:${server.address().port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

describe('createApp', () => {
  it('serves requests with the lib defaults when no settings are given', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = await listen(createApp());
    const res = await fetch(`${base}/?renderToHtml=true`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('© OpenStreetMap contributors');
  });

  it('uses `defaults` for every request, overridable by request params', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = await listen(createApp({ defaults: { attribution: 'server default' } }));

    const plain = await fetch(`${base}/dynamic`);
    expect(await plain.text()).toContain('server default');

    const custom = await fetch(`${base}/dynamic?attribution=from+request`);
    const html = await custom.text();
    expect(html).toContain('from request');
    expect(html).not.toContain('server default');

    const posted = await fetch(`${base}/dynamic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attribution: 'from body' }),
    });
    expect(await posted.text()).toContain('from body');
  });

  it('enforces `headerCheck` with the configured failure message', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = await listen(
      createApp({ headerCheck: 'x-api-key:secret', headerCheckFailMessage: 'nope' })
    );

    const denied = await fetch(`${base}/health`);
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe('nope');

    const allowed = await fetch(`${base}/health`, { headers: { 'x-api-key': 'secret' } });
    expect(allowed.status).toBe(200);
  });
});
