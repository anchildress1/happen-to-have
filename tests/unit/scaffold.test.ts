import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Guards the scaffold decisions that are silently reversible and would only surface much
 * later — chiefly that next.config must not disable the tsc CLI checker under TypeScript 7.
 *
 * It does NOT police dependency versions. Which Node runs is decided by `engines`, `.nvmrc`
 * and the CI `node-version`; an assertion on a version string in package.json decides
 * nothing and only fires when someone changes the number.
 */
describe('scaffold invariants', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('declares ESM and the Node 24 engine floor', () => {
    expect(pkg.type).toBe('module');
    expect(pkg.engines.node).toBe('>=24');
  });

  it('does not disable the TypeScript CLI checker', () => {
    // Setting experimental.useTypeScriptCli to false makes `next build` exit
    // under TypeScript 7, which ships no lib/typescript.js.
    expect(readFileSync('next.config.ts', 'utf8')).not.toMatch(/useTypeScriptCli\s*:\s*false/);
  });

  it('carries no ESLint or Prettier dependency', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((d) => /eslint|prettier/.test(d))).toEqual([]);
  });
});
