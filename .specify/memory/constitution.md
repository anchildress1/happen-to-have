<!--
SYNC IMPACT REPORT
==================
Version change: (unratified template) → 1.0.0
Bump rationale: Initial ratification. All template placeholders replaced with concrete,
testable governance derived from the "Happen to Have?" AI handoff (revision 4) and the
new-web-repo-setup GCP/Cloud Run conventions.

Modified principles:
  [PRINCIPLE_1_NAME] → I. Human Contribution Is The Product (NON-NEGOTIABLE)
  [PRINCIPLE_2_NAME] → II. Server-Authoritative Reciprocity
  [PRINCIPLE_3_NAME] → III. Aggregate Guardrail Gate (NON-NEGOTIABLE)
  [PRINCIPLE_4_NAME] → IV. Original Audio Is Transient
  [PRINCIPLE_5_NAME] → V. Structured Output Or Failure
Added principles:
  VI. Scope Discipline
  VII. Voice And Provenance
Added sections:
  Technology And Infrastructure Constraints (replaces [SECTION_2_NAME])
  Development Workflow And Quality Gates (replaces [SECTION_3_NAME])
Removed sections: none

Deferred TODOs:
  TODO(TTS_VOICE_ID): exact Gemini TTS voice unresolved — Open Decisions in the handoff.
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
- Participants MUST NOT be served their own question or a question they already answered.
- A question closes for further routing after three published answers from three distinct
  participants. Unanswered questions never expire.

**Rationale:** Reciprocity is the only rule the product has. Enforcing it client-side
makes it decorative.

### III. Aggregate Guardrail Gate (NON-NEGOTIABLE)

- An answer qualifies only when all of the following hold:
  `duration_seconds <= 60`, `processing_status == complete`,
  `guardrail_decision == pass`, `is_relevant == true`.
- The gate is the conjunction of four independent Gemini calls — content processing,
  relevance, crisis, illegal/dangerous — each receiving the original audio. No call may
  consume another call's transcript.
- Relevance MUST NOT substitute for the content, crisis, or illegal-content decisions.
- Questions run three calls (content, crisis, illegal); relevance does not apply.
- Crisis and illegal/dangerous results MUST remain distinct fields so the shared result
  page renders the correct text.
- Crisis and illegal/dangerous content MUST be withheld from the public pool and MUST NOT
  unlock asking.
- Crisis routing MUST be fixed, human-authored text with US and international resources,
  reachable without earning an ask. The app MUST NOT generate counseling or claim
  emergency intervention.
- All non-passing outcomes MUST render one result page with outcome-specific text.
- There MUST be no minimum answer duration.
- Provider or network failure MUST produce a retryable failure state, never a participant
  rejection.

**Rationale:** "Useful" is defined as this gate's result and nothing else — not recipient
approval, votes, or elapsed time. Collapsing the gate to one signal silently changes the
product's definition of a qualifying contribution.

### IV. Original Audio Is Transient

- Original participant audio MUST NOT be publicly reachable at any URL, at any time.
- Original audio MUST be deleted immediately after any terminal result — published,
  irrelevant, crisis-routed, illegal-withheld, or failed.
- On retryable infrastructure failure, original audio MAY be retained only long enough to
  retry, then deleted on the terminal result.
- Storage holding original audio MUST have a lifecycle deletion rule as a backstop; the
  rule is a safety net, not the deletion mechanism.
- Playback MUST be generated from processed text, never from the original recording.
- Generated playback MUST be lazy on first Listen, cached, and MUST NOT block publication.
- The app MUST NOT build review or playback of a participant's own original recording.

**Rationale:** People record honestly only when the raw recording cannot resurface. A
retention path that "might be useful later" is the failure mode this principle forbids.

### V. Structured Output Or Failure

- Every Gemini call MUST request structured output against an explicit schema.
- Every returned object MUST be validated in application code before use. Unvalidated
  model output MUST NOT reach the database or the UI.
- A schema-invalid or unparseable response is an infrastructure failure: retryable,
  never a participant-facing guardrail rejection.
- Processing state (`processing_status`, `processing_attempts`, `last_error`) lives on the
  question and answer rows. Separate job or audio tables MUST NOT be introduced unless a
  real worker queue or shared polymorphic audio behavior exists.

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
  no public access, and MUST NOT be served through signed public URLs.
- Relational state (participants, questions, answers) MUST live in a managed Postgres
  instance reachable from Cloud Run.

### Application Stack

- Runtime: Node.js 22+, ESM only. CommonJS patterns, legacy loaders, and compatibility
  shims are forbidden.
- Framework: Next.js (App Router) with TypeScript `strict: true`; server route handlers own
  every Gemini call. This is a MINOR-amendable decision, not a bare preference.
- Package manager: pnpm. Never npm or yarn.
- All Gemini access — transcription, processing, guardrails, TTS — goes through the Google
  Gemini API directly. No third-party audio provider.
- One TTS voice is used consistently for all generated playback.
  TODO(TTS_VOICE_ID): voice not yet selected.
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

**Version**: 1.0.0 | **Ratified**: 2026-09-04 | **Last Amended**: 2026-09-04
