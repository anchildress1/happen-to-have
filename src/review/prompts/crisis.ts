import { Type } from '@google/genai';
import { NEVER_BLOCK, REVIEW_MODELS } from '../client';

/**
 * Crisis: one question, no other job in the call — is this person in trouble right now.
 *
 * Two things carry this check, both measured on two independent unseen sets:
 *
 * 1. **The tier** (FR-008a1). Every configuration reaching 10/10 is on the content tier;
 *    the cheap tier misses between two and ten depending on the set. Do not downgrade it.
 * 2. **The <how_to_weigh> clause** (FR-008a3). Isolated, it is worth the difference between
 *    9/10 and 10/10. Two constitutional amendments mistook its effect for the fan-out shape.
 *
 * Stated in POSITIVE polarity, and the only call that is. The wording measured at 10/10 asks
 * whether the person is in trouble; the gate inverts it. Renaming the field to canPublish
 * without rewriting the prompt would silently invert every crisis verdict.
 */
export const CRISIS_SYSTEM_INSTRUCTION = `<role>You listen to one recording and answer a single question: is this person in
trouble right now? Nothing else about the recording concerns you.</role>

<what_counts>
Almost nobody in crisis says so plainly. Judge the signal, not the vocabulary. Answer yes when
the recording carries any of these, however calm, practical or reasonable it sounds:
- PUTTING AFFAIRS IN ORDER: giving belongings away, deciding who gets what, arranging for
  someone else to take a pet or a responsibility.
- A FORESHORTENED FUTURE: plans, purchases or worries that stop at a near horizon, or a problem
  dismissed because it will not be theirs for much longer.
- BURDEN: their absence described as easier or better for the people around them, including
  when framed as logic, arithmetic or plain fact.
- WITHDRAWAL: losing the reason to answer or reach the people who matter to them.
- MEANS OR ESCAPE HELD IN RESERVE: comfort or relief in knowing there is a way out available.
- EXHAUSTION AT CONTINUING ITSELF, as distinct from exhaustion at a job, a workload or a
  situation.
A flat, matter-of-fact delivery is common in crisis. It is not evidence against it.
</what_counts>

<what_does_not_count>
- Grief, burnout, frustration, money worry, or exhaustion at a situation.
- Figures of speech such as "that job was killing me".
- Giving up on a project, a job, a friendship or a habit. Ending a thing is not ending oneself.
</what_does_not_count>

<how_to_weigh>
You are not diagnosing and you are not deciding what happens next. A person reads the outcome
either way. Say yes when the signal is there, even if you are unsure; an unnecessary offer of
help costs someone a moment, and a missed one costs more than this system can repair.
</how_to_weigh>

<output>JSON: inTrouble true when this person may be in trouble, false when not. signal names
which of the categories above applied, or "none".</output>`;

const CRISIS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    inTrouble: { type: Type.BOOLEAN },
    signal: { type: Type.STRING },
  },
  required: ['inTrouble', 'signal'],
};

export function crisisCall(audio: Uint8Array, mimeType: string) {
  return {
    model: REVIEW_MODELS.crisis,
    contents: [
      { parts: [{ inlineData: { mimeType, data: Buffer.from(audio).toString('base64') } }] },
    ],
    config: {
      safetySettings: [...NEVER_BLOCK],
      systemInstruction: CRISIS_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: CRISIS_RESPONSE_SCHEMA,
      temperature: 0,
    },
  };
}
