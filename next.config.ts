import type { NextConfig } from 'next';

// Do NOT set `experimental.useTypeScriptCli`. Under TypeScript 7 the `tsc` CLI checker
// is the default type-checking path (the Go rewrite ships no `lib/typescript.js` for the
// JS compiler API), and disabling it makes `next build` exit outright.
const nextConfig: NextConfig = {
  // The Dockerfile's runner stage copies .next/standalone and runs its server.js.
  // Without this, that directory is never produced and every container build fails.
  output: 'standalone',
};

export default nextConfig;
