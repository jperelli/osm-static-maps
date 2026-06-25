import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Rendering launches a real headless browser, so allow generous timeouts.
    testTimeout: 60000,
    hookTimeout: 60000,
    // The shared browser singleton is process-global; run files sequentially
    // so concurrent renders don't contend over a single browser instance.
    fileParallelism: false,
    // Load the library through the native Node ESM loader instead of Vite's
    // SSR transform, which doesn't support `import.meta.resolve`.
    server: {
      deps: {
        external: [/src\/.*\.js$/],
      },
    },
  },
});
