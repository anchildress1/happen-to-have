<!--
SYNC IMPACT REPORT
==================
Version change: 2.0.0 → 2.1.0

AMENDMENT 2.1.0 (2026-09-05) — guardrail fan-out corrected by measurement.

Bump rationale: MINOR. A required check is ADDED to Principle III's gate; no principle is
removed, narrowed, or inverted. The gate's meaning — the conjunction of independent signals —
is unchanged. What changed is a factual claim about the provider that turned out to be wrong.

  III. Aggregate Guardrail Gate
    - Answer fan-out 3 -> 4 calls; question fan-out 2 -> 3. Illegal-or-dangerous is now a
      dedicated call for both, because the rating it was to be read from does not exist.
    - NEW: the provider's own safety signal MUST NOT be counted as one of the gate's checks.

  Technology And Infrastructure Constraints -> Application Stack
    - BLOCK_NONE retained, but its stated purpose is corrected: it prevents the provider
      silently swallowing a recording. It does not produce ratings.

  Verified block
    - The 2026-09-04 "returns ratings automatically" line is corrected. It was taken from
      documentation, not a live call.

Evidence: docs/spike-002-guardrails.md. 16 prepared recordings; at the provider's DEFAULT
guardrails, 7 of 8 must-not-publish recordings returned clean transcribed text, including
every crisis case and an explicit self-harm method.

--- 2.0.0 (2026-09-04), retained below ---

Version change: 1.0.0 → 2.0.0

1.0.0 is the last committed version (08015e5). Everything below is one amendment; intermediate
numbers were never released and are not recorded.

Bump rationale: MAJOR. Principle V's meaning is inverted — state that was required to persist on
question and answer rows is now required to exist only for the life of the request. Principle IV
is narrowed with a hard retention bound. Principle II's exclusion rule is narrowed from any
answer to a published one. Under this document's own versioning policy, narrowing or inverting a
principle is MAJOR regardless of how much else came with it.

Modified principles:

  II. Server-Authoritative Reciprocity
    - Exclusion narrowed: only a PUBLISHED answer bars a question.
    - NEW: after any withheld answer the participant is offered a fresh recording for the same
      question. Crisis is NOT exempt — the model can be wrong about crisis, and a wrong call
      must not remove the participant's ability to try again.

  III. Aggregate Guardrail Gate
    - Restructured around a uniform `canPublish` boolean per check; false always means reject.
    - Fan-out narrowed: illegal-or-dangerous reads the content call's safety ratings instead of
      taking its own call, pending spike evidence. Three calls per answer, two per question.
    - Fail-fast: any definitive NO resolves to Withheld immediately and cancels remaining work.
    - Withheld is one outcome carrying a reason, with precedence used for presentation only.

  IV. Original Audio Is Transient
    - NEW hard bound: check retries may use the audio only inside the active submission, capped
      at 90 seconds from server receipt.
    - NEW: the browser MUST release its recording when the submission ends.

  V. Structured Output Or Failure  (the MAJOR)
    - INVERTED: processing state, check results, retry counts, and storage references now exist
      only in the active request. Only published questions and answers enter the database.
    - Publication and ask grant/consumption MUST commit atomically.

Modified sections:

  Technology And Infrastructure Constraints → Platform
    - Application state is Neon (serverless Lakebase Postgres) via @neondatabase/serverless.
    - NEW: database rules — server-side access only, schema owned by committed migrations,
      parameterized queries, no denormalized counters, bounded connection pools.
    - NEW: branch-first development — every git branch gets a copy-on-write Neon branch, so
      each stacked pull request has an isolated database.

    Considered and rejected:
      Firebase SQL Connect — adopted, implemented, then reverted. Every generated operation
        was annotated @auth(level: NO_ACCESS), which disabled the product's one differentiator:
        server-deployed operations that clients may safely invoke. Nothing client-side touches
        the database, so it contributed 1.9MB of Admin SDK and a codegen build step to serve
        three one-line queries.
      Cloud Firestore — briefly adopted, then reverted. NoSQL: no joins, no cross-collection
        NOT EXISTS, no ordering by a query-time aggregate. Would have forced a drift-capable
        denormalized counter under the two rules that must not drift.
      Cloud SQL direct with `pg` — superseded by Neon: same SQL, but Neon adds scale-to-zero,
        a free tier, and branchable databases.

  Technology And Infrastructure Constraints → Application Stack
    - Gemini access MUST use the official `@google/genai` SDK, server-side only.
    - Model ids pinned per job: gemini-3.8-flash for content processing, gemini-3.5-flash-lite
      for the three boolean guardrails, gemini-3.1-flash-tts-preview for playback.
    - NEW: the content-processing call sets every safety category to BLOCK_NONE. Illegal-or-
      dangerous, crisis, and relevance are each a dedicated Flash-Lite call; BLOCK_NONE exists
      to stop the provider swallowing a recording, not to obtain ratings. Checks stay separate
      parallel threads. (Amended 2.1.0 — the free-ratings premise was falsified by the spike.)
    - Live API models forbidden outright, with the Principle I and IV conflicts named.
    - Runtime narrowed from "Node.js 22+" to "Node.js 24 LTS" (Krypton).

Added principles: none
Removed sections: none

Verified 2026-09-04:
  Neon project silent-meadow-11692011 (org org-bold-hat-14494774), aws-us-east-2, Postgres 18.
  @neondatabase/serverless 1.1.0, node-pg-migrate 9.0.0 — npm registry.
  @google/genai 2.21.0 (2026-09-02), engines: node >=20.0.0.
  gemini-3.8-flash and gemini-3.5-flash-lite are GA; both accept audio and structured output.
  All Gemini TTS ids are preview; no GA text-to-speech model exists.
  Gemini safety filter accepts HARM_CATEGORY_{HARASSMENT,HATE_SPEECH,SEXUALLY_EXPLICIT,
  DANGEROUS} as request-side thresholds. No self-harm or crisis category exists.
  CORRECTED 2026-09-05 by live measurement: it does NOT return ratings. `safetyRatings` is
  absent from the response at BLOCK_NONE, at default thresholds, and with no safety config.
  The 2026-09-04 entry was read from documentation and never called.
  Node 24 (Krypton) Active LTS through 2026-10-20, maintenance to 2028-04-30.

Deferred TODOs:
  TODO(TTS_VOICE_ID): exact Gemini TTS voice unresolved. The model is pinned; the voice is not.
  TODO(DISPLAY_LANGUAGE_POLICY): MVP display/translation language unresolved; English is
    the working assumption.
-->

# Happen to Have? Constitution

## Core Principles

### I. Human Contribution Is The Product (NON-NEGOTIABLE)

- Every question and every answer MUST originate from a human recording.
- Gemini MUST only transcribe, translate, redact, classify, and voice human contributions.
- Generated text MUST NOT add advice, facts, recommendations, or moral judgment absent
  from the source recording.
- Gemini, the recorder, and the processing pipeline MUST NOT be described as an agent
  in code, docs, UI copy, or marketing.
- ElevenLabs products, including ElevenAgents, are forbidden in any role — provider,
  middleman, or playback.

**Rationale:** The product's entire claim is that a human answered. Any generated advice
voids that claim, and agent framing invites reviewers to read the app as a chatbot.

### II. Server-Authoritative Reciprocity

- One qualifying answer grants exactly one ask. Asking consumes the unlock.
- Ask eligibility MUST be computed and enforced on the server. Client state is advisory.
- Unlock MUST occur only after processing completes and the aggregate gate passes.
  Recording completion MUST NOT unlock asking.
- Participants MUST NOT bank more than one ask.
- Skipping a question MUST NOT start a recording, grant an ask, or advance toward one.
- The ask MUST be consumed only when the question row is successfully created.
- Participants MUST NOT be served their own question, or a question to which they already hold a
  **published** answer.
- A withheld or failed attempt MUST NOT exclude a question. It never counted, so the question MUST
  remain eligible for that participant.
- After any withheld answer, including crisis, the participant MUST be offered a fresh recording
  for the same question without locating it in the pool again. A withheld question MUST return
  to question recording with its ask intact. Crisis resources remain available alongside retry.
- A question closes for further routing after three published answers from three distinct
  participants. Unanswered questions never expire.

**Rationale:** Reciprocity is the only rule the product has. Enforcing it client-side
makes it decorative.

"Already answered" means an answer that counted. A contribution the gate withheld published
nothing, granted no ask, and left no trace another participant can see — so it MUST NOT also cost
the participant the question. Excluding on any attempt punishes a clipped recording or a quiet
microphone, not bad faith; the submission rate limit is the control for volume. Gemini can be
wrong about crisis too, so that result MUST NOT remove the participant's ability to try again.

### III. Aggregate Guardrail Gate (NON-NEGOTIABLE)

- An answer qualifies only when its verified duration is at most 60 seconds and every applicable
  check has completed with validated `canPublish == true`.
- The gate is the conjunction of independent signals, each derived from the original audio.
  For an answer: content processing, relevance, crisis, and illegal-or-dangerous as four
  parallel calls. For a question: content processing, crisis, and illegal-or-dangerous, three
  calls; relevance does not apply.
- The provider's own safety signal MUST NOT be treated as one of these checks. It returns no
  ratings to read, and at its default thresholds it passed 7 of 8 must-not-publish recordings
  in the 002 spike. It is not a guardrail this product may rely on.
- No call may consume another call's transcript, and calls MUST NOT be merged into one that
  returns several verdicts.
- Relevance MUST NOT substitute for the content, crisis, or illegal-content decisions.
- Every review check MUST return `canPublish`: true means YES and false means NO, including
  crisis and illegal checks. False means rejection, never absence of a detected hazard.
- Any definitive NO MUST immediately resolve to Withheld, cancel remaining work where possible,
  and suppress further retries and late results. Publication waits for every applicable YES.
- A YES is kept for the active submission. Only a timed-out, failed, or schema-invalid check
  retries independently, and only while no check has rejected the submission.
- Withheld is one outcome with a reason: crisis, illegal/dangerous, relevance, or content.
  If multiple rejections are already known at resolution, use that precedence for presentation;
  do not delay Withheld to wait for unfinished checks.
- Crisis and illegal/dangerous content MUST be withheld from the public pool and MUST NOT
  unlock asking.
- Crisis routing MUST be fixed, human-authored text with US and international resources,
  reachable without earning an ask. The app MUST NOT generate counseling or claim
  emergency intervention.
- Every rejection MUST render the shared Withheld page with reason-specific text; exhausted
  infrastructure failures use the processing-failure state rather than Withheld.
- There MUST be no minimum answer duration.
- Exhausted provider or network retries MUST produce a processing-failure state offering a
  fresh recording, never a participant rejection or a promise to restore an old attempt.

**Rationale:** "Useful" is defined as this gate's result and nothing else — not recipient
approval, votes, or elapsed time. Collapsing the gate to one signal silently changes the
product's definition of a qualifying contribution.

### IV. Original Audio Is Transient

- Original participant audio MUST NOT be publicly reachable at any URL, at any time.
- Original audio MUST be deleted immediately after publication, Withheld, processing failure,
  or abandonment. It MUST NOT be retained for a later attempt.
- Independent check retries MAY use the audio only inside the current active submission,
  bounded to 90 seconds from server receipt; expiry cancels review and triggers deletion.
- The browser MUST release its recording after the submission ends or the participant leaves.
  Refreshing or returning later MUST NOT restore a recording or an unpublished attempt.
- Storage holding original audio MUST have a lifecycle deletion rule as a backstop; the
  rule is a safety net, not the deletion mechanism.
- Playback MUST be generated from processed text, never from the original recording.
- Generated playback MUST be lazy on first Listen, cached, and MUST NOT block publication.
- The app MUST NOT build review or playback of a participant's own original recording.

**Rationale:** People record honestly only when the raw recording cannot resurface. A
retention path that "might be useful later" is the failure mode this principle forbids.

### V. Structured Output Or Failure

- Every Gemini review call MUST request structured output against an explicit schema.
- TTS MUST NOT request structured output; validate the returned audio type and nonempty payload
  before caching or serving it.
- Every returned object MUST be validated in application code before use. Unvalidated
  model output MUST NOT reach the database or the UI.
- A schema-invalid or unparseable response is an infrastructure failure: retryable,
  never a participant-facing guardrail rejection.
- Processing state, check results, retry counts, and storage references exist only in the active
  request. Only published questions and answers enter the database and `Yours`.
- Pending, withheld, failed, or abandoned attempts MUST NOT be stored as contribution rows,
  attempt history, or recovery jobs. Publication and ask grant/consumption MUST commit atomically.

**Rationale:** The gate is only as trustworthy as the parsing in front of it. Trusting
shape without validating it turns a model hiccup into a wrongly granted ask.

### VI. Scope Discipline

- KISS and YAGNI outrank every other design preference.
- The handoff's exclusion list is binding: no conversational agents, native apps, wallets,
  expert matching, public profiles, followers, DMs, comment trees, votes, ratings,
  accepted answers, leaderboards, recommendation feeds, delegation, pre-publication review
  screens, or original-audio publishing.
- Backward compatibility MUST NOT be preserved unless explicitly requested. Prerelease
  changes are never breaking changes.
- Any capability that fails the initial technical spike MUST be killed or simplified
  before UI work begins on it.
- Identity is anonymous session-scoped. Signup MUST NOT be added unless durable
  cross-device access becomes a stated requirement. The soft reciprocity gate this creates
  is a documented, accepted limitation.

**Rationale:** The build window is two days. Every excluded feature was excluded on
purpose, and re-litigating one costs more than it returns.

### VII. Voice And Provenance

- Product name is **Happen to Have?** — the question mark is part of the name.
- Tagline is **Answer one. Ask one.**
- Copy MUST NOT use "who answers" framing, "let me ask someone else" framing, or position
  the product as a marketplace, expert network, therapy service, or social feed.
- Appalachia belongs to the origin story and values only. The app MUST NOT generate,
  imitate, or market an Appalachian dialect, and MUST NOT restrict participants by region.
- "Busy Bees" is origin-story context, never the product name or visual theme.
- Safety is expected infrastructure. "Safe" MUST NOT appear as product positioning or
  routine participant-facing copy.

**Rationale:** The name carries a real place and a real family story. Turning either into
a performance or a marketing hook is the one failure that cannot be patched later.

## Technology And Infrastructure Constraints

### Platform

- Target platform is Google Cloud Run in `us-east1`, deployed from a repo-root `deploy.sh`
  with per-service Dockerfiles.
- Container images MUST publish to Artifact Registry under the deploying project.
- Secrets MUST live in Secret Manager or a local, gitignored `.env`. Real credentials MUST
  NOT appear in the repository, in workflow logs, or in example files.
- Transient audio MUST live in a Cloud Storage bucket with uniform bucket-level access and
  no public access, and MUST NOT be served through signed public URLs..
- Application state (participants, questions, answers) MUST live in **Neon** — serverless
  Lakebase Postgres — reached through `@neondatabase/serverless`.

#### Database rules

- All database access MUST happen server-side, in a route handler or a server-only module.
  The connection string MUST NOT reach the browser; a client that can read it can forge its
  own ask eligibility, which is a Principle II violation.
- Schema is owned by SQL migrations under `migrations/`, applied with `node-pg-migrate` and
  committed to the repository. A schema change made by hand against a branch does not exist
  as far as this repository is concerned.
- Every query MUST use `$1`-style placeholders. String-interpolating a value into SQL is
  forbidden.
- Answer counts MUST be computed relationally with `COUNT`. Denormalized counters MUST NOT be
  introduced: a drifted count silently corrupts both the fewer-answers selection bias and the
  three-answer closure rule, and `COUNT` cannot drift.
- Every row crossing into application code MUST be validated before use, per Principle V.
- Connection pools MUST cap `max` low enough that the cap multiplied by Cloud Run's
  `max-instances` stays inside the project's connection limit. Prefer Neon's pooled endpoint.

#### Branch-first development

- Every git branch MUST have a corresponding Neon branch, created with `neon checkout`. A
  Neon branch is a copy-on-write clone, so this costs approximately nothing and gives each
  stacked pull request an isolated database.
- Migrations run against the checked-out branch, never against `main` by hand.
- `.neon` and `.env` are per-checkout state and MUST stay gitignored.

### Application Stack

- Runtime: Node.js 24 LTS, ESM only. CommonJS patterns, legacy loaders, and compatibility
  shims are forbidden.
- Framework: Next.js (App Router) with TypeScript `strict: true`; server route handlers own
  every Gemini call. This is a MINOR-amendable decision, not a bare preference.
- Package manager: pnpm. Never npm or yarn.
- All Gemini access — transcription, processing, guardrails, TTS — MUST go through the official
  **Google Gen AI SDK for TypeScript and JavaScript**, package `@google/genai`
  (<https://googleapis.github.io/js-genai/release_docs/>). No third-party audio provider, no
  hand-rolled REST calls, and not the superseded `@google/generative-ai` package.
- Clients MUST be constructed server-side only. An API key MUST NOT reach the browser.
- Every review call MUST use an explicit `responseSchema`, per Principle V; TTS is exempt.
- Model ids are pinned here and MUST NOT be varied per call site:

  | Job | Model | Why |
  | - | - | - |
  | Content processing (transcribe, translate, redact, emotion) | `gemini-3.8-flash` | The one call doing real extraction and transformation. GA, accepts audio, structured output. |
  | Relevance check | `gemini-3.5-flash-lite` | Single boolean. GA, fastest, cheapest. |
  | Crisis check | `gemini-3.5-flash-lite` | Single boolean. |
  | Illegal or dangerous check | `gemini-3.5-flash-lite` | Single boolean. |
  | Generated playback (TTS) | `gemini-3.1-flash-tts-preview` | Lowest-latency TTS with expressive control. |

- Running all four review calls at the top tier buys latency and cost, not accuracy. The three
  guardrails are boolean classification and belong on Flash-Lite.
- Content processing runs on Flash, not Pro. The participant is blocked on the Checking state
  while the review runs, so the critical path takes the GA tier with the better latency and cost
  profile. The job is extraction and transformation over one minute of audio, not the multi-step
  reasoning Pro exists for.
- Content processing MUST NOT be downgraded to Flash-Lite without spike evidence. Flash-Lite is
  documented for "simple data extraction"; this call transcribes dialect, translates, redacts
  identifying details, preserves the participant's substance, and returns a multi-field guardrail
  decision. **Redaction is the only failure in the product that cannot be retried** — a missed name
  is published. If the 002 spike shows Flash-Lite matching Flash on the privacy and multilingual
  test sets, downgrading is a MINOR amendment; until then it is a guess.
- `gemini-3.1-pro-preview` is the documented escalation for content processing if the spike shows
  Flash missing on redaction or translation. It costs latency, spend, and preview risk on the
  critical path, so it MUST NOT be adopted pre-emptively.
- Only one pinned model is preview: the TTS id, and only because no GA text-to-speech model
  exists. Every call the reciprocity gate depends on runs GA.
- Every model in the table above MUST be callable via `generateContent`. **Live API models are
  forbidden**: `gemini-3.5-live-translate-preview`, `gemini-3.1-flash-live-preview`, and
  `gemini-2.5-flash-native-audio-preview-12-2025` run over a stateful WebSocket session, are
  speech-to-speech, and cannot return structured text. They also contradict Principle I — this
  product is an asynchronous recording workflow, not a conversation — and Principle IV, because
  a speech-to-speech path would derive playback from the original recording rather than from
  processed text.
- `gemini-3.1-flash-tts-preview` is a **preview** model. Every Gemini TTS id is preview — there is
  no GA text-to-speech model. This is accepted, and MUST NOT be described to participants or in
  marketing as stable.
- These ids MUST be re-verified against <https://ai.google.dev/gemini-api/docs/models> before any
  spec that calls them is planned. Names churn fast: `gemini-3.5-flash` went from default
  workhorse to legacy baseline in one quarter.
- Never use, shut down or deprecated: `gemini-2.0-flash`, `gemini-2.0-flash-lite`,
  `gemini-3.1-flash-lite-preview`, `gemini-3-pro-preview`, `imagen-4.0-generate`.
- One TTS voice is used consistently for all generated playback.
  TODO(TTS_VOICE_ID): voice not yet selected. The TTS *model* is pinned above; the *voice* is not.
  TODO(DISPLAY_LANGUAGE_POLICY): display/translation language policy not yet settled;
  English is the working assumption.

### Abuse And Cost Controls

- The submission endpoint MUST enforce a server-side rate limit whose numeric values are
  configurable without a code change.
- Rate-limit responses MUST tell the participant when they can retry.
- Limits MUST be validated against a complete Answer-then-Ask cycle before shipping. Limits
  copied from another product without that test are non-compliant.
- Silence and invalid audio SHOULD be rejected before spending downstream Gemini calls.
- CAPTCHA, IP blocking, and account suspension are out of scope for the MVP.

## Development Workflow And Quality Gates

### Repository

- Commits are atomic, GPG-signed, Conventional Commits, and carry an AI-attribution footer.
- Commits never land directly on `main`. Branch and PR always.
- Small dependent changes join an existing related branch rather than spawning a new one.
- Repository configuration files MUST NOT be modified without explicit instruction;
  recommended changes are surfaced in review instead.
- License is Polyform Shield 1.0.0. `.github/CODEOWNERS` is `* @anchildress1`.

### Required Tooling

- `Makefile` MUST expose: `install`, `dev`, `format`, `format-check`, `lint`, `typecheck`,
  `test`, `build`, `e2e`, `perf`, `secret-scan`, `clean`.
- Lefthook hooks: pre-commit (format, lint, secret scan, actionlint), commit-msg
  (commitlint with the RAI plugin), pre-push (typecheck, unit, E2E).
- CI MUST include SonarCloud inside the CI workflow, a CodeQL workflow, Release Please,
  and Dependabot with grouped ecosystems and `cooldown.default-days: 7`.
- Every dependency and GitHub Action version MUST be verified against a current source
  before it is written. Versions from memory or stale reference files are non-compliant.
- Third-party actions MUST be SHA-pinned with the version tag in a trailing comment.
- Warnings from linters, compilers, test runners, and scanners are hard errors.

### Verification

- Before any implementation change is reported complete: format, lint, typecheck, tests,
  coverage review, docs update where relevant, and a security pass. `make ai-checks` is
  preferred where it exists.
- Maximum three validation attempts. On repeated failure, stop and surface the exact
  errors without reinterpretation.
- Work returned under an explicit "I'll test" or "unverified" instruction MUST be labeled
  **UNVERIFIED**.
- The reciprocity gate, the aggregate guardrail gate, and the audio-deletion path MUST have
  automated tests. A fix without a test or repeatable manual proof MUST NOT be proposed.
- The handoff's Required Validation Cases are the acceptance floor. Each MUST map to at
  least one automated or scripted check before deploy.

### Documentation

- Audience is decided by filename. `AGENTS.md`, `SKILL.md`, and their `references/*` are
  AI-only and directive. `README.md`, `docs/*.md`, ADRs, and PR descriptions are for humans.
- All human documentation lives under `./docs` in logical subfolders. Update existing docs
  rather than adding new files. ADRs are historical and MUST NOT be rewritten.
- Inline comments explain *why* only. API docs explain *what* and *how*, one sentence.
- Diagrams use Mermaid with accessibility labels, the default profile, and validated syntax.

## Governance

- This constitution supersedes conflicting practice, convention, and preference in this
  repository. Where it conflicts with the AI handoff, the handoff's "Do not reinterpret"
  section wins and this document MUST be amended to match.
- Amendments require a PR that states the changed principle, the rationale, and the version
  bump. Amendments MUST NOT be made silently inside a feature PR.
- Versioning is semantic:
  - **MAJOR** — a principle is removed, or its meaning is narrowed or inverted.
  - **MINOR** — a principle or section is added, or guidance is materially expanded.
  - **PATCH** — clarification, wording, or typo fixes with no change in obligation.
- Every PR review MUST verify compliance with Principles I–V explicitly. Any deviation
  MUST be justified in the PR description or the PR MUST be rejected.
- Complexity MUST be justified against Principle VI. "It might be useful later" is not a
  justification.
- `AGENTS.md` and `CLAUDE.md` carry runtime development guidance and MUST NOT restate or
  contradict the principles above.

**Version**: 2.1.0 | **Ratified**: 2026-09-04 | **Last Amended**: 2026-09-05
