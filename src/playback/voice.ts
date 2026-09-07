/**
 * The single voice used for every generated playback in the product (FR-025).
 *
 * **This is the only place the voice id is written.** The constitution's Application Stack
 * section requires exactly one export so that document and this constant cannot drift apart —
 * a lesson from amendment 5.0.1, where a pinned model in a reference table disagreed with the
 * principle above it for two revisions because nothing cross-checked them.
 *
 * `Sulafat` is characterized by the provider as *Warm*, and warmth is the choice rather than a
 * default. Principle VII forbids generating, imitating, or marketing an Appalachian dialect,
 * which removes the axis the product's origin story would otherwise suggest. What is left is
 * register: a stranger's advice, read back to the person who asked for it, wants warmth that
 * does not tip into cheerfulness (`Achird`, Friendly), consolation (`Vindemiatrix`, Gentle), or
 * inertness (`Schedar`, Even).
 *
 * Not measured, and not claimed to be. Unlike the crisis tier in Principle III, no test set can
 * score a voice against "sounds like a neighbor rather than a performance". Recorded as a
 * judgment in constitution amendment 5.0.2 and revisitable by a MINOR amendment once heard.
 *
 * `Kore` appears in `docs/spike-002-guardrails.md` and `Enceladus` in the crisis fixture
 * filenames under `tests/fixtures/audio/`. Both were spike instruments. Neither is this.
 */
export const VOICE_ID = 'Sulafat';
