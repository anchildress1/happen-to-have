// ESM only — no CommonJS (constitution, Application Stack).
//
// `rai-footer-exists` enforces the AI-attribution trailer the constitution's Repository
// section requires. Loading the plugin alone enforces nothing — the rule has to be on.
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
    'rai-footer-exists': [2, 'always'],
  },
};
