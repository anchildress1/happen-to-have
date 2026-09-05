import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws by design outside a React Server Component, which
      // includes any node test runner. Its own package maps the `react-server`
      // condition to empty.js; point at that so modules importing it are loadable
      // under test. The production guard is unaffected — Next.js enforces it at
      // bundle time, not through this alias.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
      // Mirrors tsconfig's `"@/*": ["./src/*"]`. Next resolves it from tsconfig; Vitest
      // does not read `paths`, so a test importing anything under `app/` — which uses the
      // alias throughout — fails to resolve without this.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
        },
      },
    ],
  },
});
