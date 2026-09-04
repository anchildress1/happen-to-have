// ESM only — no CommonJS (constitution, Application Stack).
//
// Every commit also carries an AI-attribution trailer (e.g. `Co-Authored-By: <model>
// <noreply@anthropic.com>`) per the constitution's Repository section. commitlint
// cannot see trailer content through config alone; the generate-commit-message
// workflow is what actually appends it. If enforcement in CI is ever wanted, add
// `commitlint-plugin-rai` is wired in below and enforces that trailer.
export default {
  plugins: ['commitlint-plugin-rai'],
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    'subject-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
    'footer-max-line-length': [2, 'always', 100],
  },
};
