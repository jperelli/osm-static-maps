import { describe, it, expect } from 'vitest';
import osmsm from '../src/lib.js';

// These tests exercise the Handlebars template by rendering to HTML
// (`renderToHtml: true`), so they are fast and require no headless browser.

const POINT = '{"type":"Point","coordinates":[-105.01621,39.57422]}';

describe('renderToHtml', () => {
  it('returns an HTML string with the leaflet map scaffold', async () => {
    const html = await osmsm({ renderToHtml: true });
    expect(typeof html).toBe('string');
    expect(html).toContain('<div id="map">');
    expect(html).toContain("new L.Map('map'");
  });

  it('inlines the leaflet library (no external CDN dependency)', async () => {
    const html = await osmsm({ renderToHtml: true });
    // the placeholder must have been replaced by the actual library source
    expect(html).not.toContain('//leafletjs//');
    expect(html).toContain('Leaflet');
  });

  it('embeds the provided geojson into the page', async () => {
    const html = await osmsm({ geojson: POINT, renderToHtml: true });
    expect(html).toContain('L.geoJson(');
    expect(html).toContain('-105.01621');
  });

  it('accepts geojson as an object and serializes it', async () => {
    const html = await osmsm({
      geojson: { type: 'Point', coordinates: [1.23, 4.56] },
      renderToHtml: true,
    });
    expect(html).toContain('1.23');
    expect(html).toContain('4.56');
  });

  it('uses the default attribution when none is given', async () => {
    const html = await osmsm({ renderToHtml: true });
    expect(html).toContain('© OpenStreetMap contributors');
  });

  it('honours a custom attribution', async () => {
    const html = await osmsm({ attribution: 'my custom legend', renderToHtml: true });
    expect(html).toContain('my custom legend');
  });

  it('only includes the polyline decorator and scale when requested', async () => {
    const plain = await osmsm({ renderToHtml: true });
    expect(plain).not.toContain('L.control.scale(');
    expect(plain).not.toContain('arrowHead');

    const decorated = await osmsm({ arrows: true, scale: true, renderToHtml: true });
    expect(decorated).toContain('L.control.scale(');
    expect(decorated).toContain('arrowHead');
  });

  it('wires up the maplibre vector layer only when vectorserverUrl is set', async () => {
    const raster = await osmsm({ renderToHtml: true });
    expect(raster).toContain('L.tileLayer(');
    expect(raster).not.toContain('L.maplibreGL(');

    const vector = await osmsm({
      vectorserverUrl: 'https://example.com/style.json',
      renderToHtml: true,
    });
    expect(vector).toContain('L.maplibreGL(');
    expect(vector).toContain('https://example.com/style.json');
  });

  it('sends the vector token as a bearer header only when provided', async () => {
    const withToken = await osmsm({
      vectorserverUrl: 'https://example.com/style.json',
      vectorserverToken: 'secret-token',
      renderToHtml: true,
    });
    expect(withToken).toContain('Bearer secret-token');

    const withoutToken = await osmsm({
      vectorserverUrl: 'https://example.com/style.json',
      renderToHtml: true,
    });
    expect(withoutToken).not.toContain('Bearer');
  });

  it('uses the provided tileserverUrl', async () => {
    const html = await osmsm({
      tileserverUrl: 'https://tiles.example.com/{z}/{x}/{y}.png',
      renderToHtml: true,
    });
    expect(html).toContain('https://tiles.example.com/{z}/{x}/{y}.png');
  });

  it("rejects when both 'geojson' and 'geojsonfile' are provided", async () => {
    await expect(
      osmsm({ geojson: POINT, geojsonfile: 'http://example.com/x.json', renderToHtml: true })
    ).rejects.toThrow(/Only one option allowed/);
  });
});
