import { Type } from '@google/genai';
import { NEVER_BLOCK, REVIEW_MODELS } from '../client';

/** Illegal or dangerous (FR-008c). Judges the instruction given, not the topic it sits near. */
export const ILLEGAL_SYSTEM_INSTRUCTION = `<role>You judge one spoken recording on a single question: may it be published, or is it
unlawful or dangerous? You never transcribe it and never repeat its content.</role>

<what_counts>
- canPublish is false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
</what_counts>

<never>
- Do NOT return false for lawful activity involving weapons, alcohol, money, or risk.
- Do NOT return false because the recording is off-topic, sad, or badly argued. Those are other
  calls' questions.
</never>

<examples>
- "Take a hunter safety course and get your license" -> true.
- "Buy from a private seller where no background check is required" -> false.
</examples>

<output>JSON matching the schema. detail is one short clause for operators, never shown to
anyone. Do NOT quote the recording and do NOT include identifying details.</output>`;

/** Relevance (FR-008g). Answers only — never dispatched for a question. */
export const RELEVANCE_SYSTEM_INSTRUCTION = `<role>You judge one spoken answer on a single question: does it engage the question it was
given? You never transcribe it and never repeat its content.</role>

<what_counts>
- canPublish is true when the answer engages the question, even briefly, badly, or wrongly.
- canPublish is false only when the answer is about something else.
</what_counts>

<never>
- Do NOT return false because the advice is dangerous, illegal, or offensive. Another call
  decides that, and confusing the two makes off-topic indistinguishable from unsafe.
</never>

<examples>
- Q "How do I start deer hunting?" A "Buy a gun illegally." -> true. On topic, unlawful.
</examples>

<output>JSON matching the schema. detail is one short clause for operators, never shown to
anyone. Do NOT quote the recording and do NOT include identifying details.</output>`;

const VERDICT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: { canPublish: { type: Type.BOOLEAN }, detail: { type: Type.STRING } },
  required: ['canPublish', 'detail'],
};

function verdictCall(model: string, systemInstruction: string) {
  return (audio: Uint8Array, mimeType: string, questionText?: string) => ({
    model,
    contents: [
      {
        parts: [
          { inlineData: { mimeType, data: Buffer.from(audio).toString('base64') } },
          ...(questionText
            ? [{ text: `The question asked was: "${questionText}"\n\nJudge the recording above.` }]
            : []),
        ],
      },
    ],
    config: {
      safetySettings: [...NEVER_BLOCK],
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: VERDICT_RESPONSE_SCHEMA,
      temperature: 0,
    },
  });
}

export const illegalCall = verdictCall(REVIEW_MODELS.illegal, ILLEGAL_SYSTEM_INSTRUCTION);
export const relevanceCall = verdictCall(REVIEW_MODELS.relevance, RELEVANCE_SYSTEM_INSTRUCTION);
