# Changelog

## 1.0.0 (2026-09-06)


### ⚠ BREAKING CHANGES

* `judgmentResultSchemaFor`, `JudgmentResult`, `JudgmentPayload`  and `audioQualitySchema` are removed. `ReviewCall` gains three members and  `CheckResult` is now a four-way union. Generated-by: Claude Opus 5 <noreply@anthropic.com> Co-Authored-By: Claude Opus 5 <noreply@anthropic.com> Claude-Session: https://claude.ai/code/session_01HBEth1HP7HLTBBNwZz9iHb
* schema.gql, and DATABASE_URL replaces the Firebase project configuration.
* commit publication and ask grant/consumption atomically instead.

### Features

* add a green question-mark favicon ([5140b42](https://github.com/anchildress1/happen-to-have/commit/5140b42a45673044c94238a1a8c11610b632b1bb))
* add every fixed string the review renders ([#21](https://github.com/anchildress1/happen-to-have/issues/21)) ([9736f87](https://github.com/anchildress1/happen-to-have/commit/9736f87d6a6735c9022916dc8875236102ac3433))
* add the arrival and question selection screens ([7508f4b](https://github.com/anchildress1/happen-to-have/commit/7508f4bef021b4c32658095e2db47e02a6865319))
* add the data layer, participant identity, and seeding ([06fe217](https://github.com/anchildress1/happen-to-have/commit/06fe2176276520e617bde13757d07b7de799f64b))
* add the design system foundation ([13fd2be](https://github.com/anchildress1/happen-to-have/commit/13fd2be52b5610804fc6fb867d11f05900345ccd))
* add the provider client seam for the review engine ([#17](https://github.com/anchildress1/happen-to-have/issues/17)) ([72da801](https://github.com/anchildress1/happen-to-have/commit/72da80137f4202b840dea0086abde46a0d491db1))
* bound each provider call to its own retry budget ([#19](https://github.com/anchildress1/happen-to-have/issues/19)) ([a992dd5](https://github.com/anchildress1/happen-to-have/commit/a992dd5d850bfbf4354f6cd747f44b7636a65eb8))
* bound submissions with a server-side rate limit ([#20](https://github.com/anchildress1/happen-to-have/issues/20)) ([5867e9b](https://github.com/anchildress1/happen-to-have/commit/5867e9b9c69a9d00be98a4b67b436886c62f27fc))
* complete the selection states and make the stack deployable ([71bb862](https://github.com/anchildress1/happen-to-have/commit/71bb862b356bfbc1d27eaf175090905d34b124c9))
* render the empty-pool and failure states (FR-029) ([9184a79](https://github.com/anchildress1/happen-to-have/commit/9184a79c7cdae57e140782194788346a7079bbf2))
* validate every provider response before it is used ([#18](https://github.com/anchildress1/happen-to-have/issues/18)) ([a46bd5c](https://github.com/anchildress1/happen-to-have/commit/a46bd5ce1c9ecfb4aabc4efba77166dc960f431f))


### Bug Fixes

* correct skip traversal at a pass boundary and for a pool of one ([87dac53](https://github.com/anchildress1/happen-to-have/commit/87dac537be7104e706f061f3d67b2f1d45180759))
* give the header link its own 44px hit target (T083b) ([1e3ea2b](https://github.com/anchildress1/happen-to-have/commit/1e3ea2befaf6b0463aa66461e61f0c349e53442b))
* harden three defaults flagged in review ([7e857e5](https://github.com/anchildress1/happen-to-have/commit/7e857e5b5661153668ad487cf342a3cd7c999e5a))
* hold the displayed question by id across a wrap refresh ([05bdbba](https://github.com/anchildress1/happen-to-have/commit/05bdbba277abdcc156059697f70256b91ef1a533))
* keep the session cookie when selection fails ([26aa0e7](https://github.com/anchildress1/happen-to-have/commit/26aa0e7d8488309748771626be902aa2ca72902d))
* make the container image buildable and deployable ([ed14bc2](https://github.com/anchildress1/happen-to-have/commit/ed14bc2efd8da1445d5e6f4b1878f443a7d44b0e))
* match Secret Manager's naming and let GCP own image retention ([b8aef28](https://github.com/anchildress1/happen-to-have/commit/b8aef287ef5ae4a540917436b6aef04c4e4fa5fd))
* prune the oldest images, not an arbitrary three ([5765aaa](https://github.com/anchildress1/happen-to-have/commit/5765aaab9abb60a67ef374c92a3e70a93747f39a))
* raise helper and footer text to WCAG AA contrast ([2e3092f](https://github.com/anchildress1/happen-to-have/commit/2e3092fc44b7eb81967babc0296660ea9b4cf567))
* run migrations over the direct Neon endpoint ([f805914](https://github.com/anchildress1/happen-to-have/commit/f805914b15a10a7ccc1b020fd0f2a4037e10f495))
* stop E2E runs writing participants to a shared database ([2bc8ab1](https://github.com/anchildress1/happen-to-have/commit/2bc8ab1d415af110425493b3805651f2567ecabd))
* stop sending answer data with the question queue ([2401a55](https://github.com/anchildress1/happen-to-have/commit/2401a55e2a2ce2b0aff8a9af21c8e305ccf8725d))
* stop two CSS modules racing for the same max-width on .content ([b2ceb51](https://github.com/anchildress1/happen-to-have/commit/b2ceb51bf2630c21abe32398b904481e5feadf61))
* supply DATABASE_URL to Cloud Run and load .env in db targets ([a5ba449](https://github.com/anchildress1/happen-to-have/commit/a5ba449e17c625816e7f930e37061efb3ed9ab1b))
* suppress body hydration warnings from browser extensions ([5d831b4](https://github.com/anchildress1/happen-to-have/commit/5d831b4d219237b2c446466573af4c3c20dfed85))


### Performance Improvements

* drop the participant existence check from the selection read path ([24d869a](https://github.com/anchildress1/happen-to-have/commit/24d869a127662a21ffcfb25c4243233cbfa3881d))
* overlap the participant check with question selection ([aa5ba5f](https://github.com/anchildress1/happen-to-have/commit/aa5ba5fd762ef7578b20f40e59339b985cf81697))


### Documentation

* amend constitution to 2.0.0 ([2460ce3](https://github.com/anchildress1/happen-to-have/commit/2460ce30249ad5fe2169dc16fb9f5181836cc47e))


### Code Refactoring

* replace Firebase SQL Connect with Neon and plain SQL ([cc5dfc2](https://github.com/anchildress1/happen-to-have/commit/cc5dfc2feca2bc11721451b89b0d64367c921a14))
