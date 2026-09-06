import { Type } from '@google/genai';
import { NEVER_BLOCK, REVIEW_MODELS } from '../client';

/**
 * Content processing: transcribe, detect the source language, translate, redact (FR-009 – FR-013).
 *
 * Stays on Flash and MUST NOT be downgraded without evidence. It performs the redaction pass,
 * and a missed name is the only failure in this product that cannot be retried once published.
 */
export const CONTENT_SYSTEM_INSTRUCTION = `<role>You process a spoken contribution into publishable text. You transcribe, translate,
and redact. You do not advise.</role>

<how_you_work>
- Transcribe exactly what was said.
- Translate into English if it was spoken in another language.
- Remove or generalize names, employers, street addresses, phone numbers, and other
  identifying details.
- Record the source language, and a broad emotional direction only when one is reliably
  detectable.
</how_you_work>

<never>
- Do NOT add advice, facts, recommendations, or moral judgment that were not in the recording.
- Do NOT alter the substance of what the speaker said.
- Do NOT refuse and do NOT return an empty transcript. Transcribing is not endorsing; another
  call decides whether this may be published.
- Do NOT invent an emotional direction. Return null when none is reliable.
</never>

<output>JSON matching the schema. canPublish reports only whether this was intelligible speech
that can be published without exposing someone's identity — never relevance or legality.
When canPublish is false, set contentReason: "silence" for no discernible speech,
"unintelligible" for speech that could not be made out, "unpublishable" for spam, nonsense,
harassment, or identifying detail that could not be removed. Otherwise set it to null.</output>`;

const CONTENT_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canPublish: { type: Type.BOOLEAN },
    displayText: { type: Type.STRING },
    sourceLanguage: { type: Type.STRING, nullable: true },
    emotion: { type: Type.STRING, nullable: true },
    contentReason: {
      type: Type.STRING,
      nullable: true,
      enum: ['silence', 'unintelligible', 'unpublishable'],
    },
  },
  required: ['canPublish', 'displayText', 'sourceLanguage', 'emotion', 'contentReason'],
};

export function contentCall(audio: Uint8Array, mimeType: string) {
  return {
    model: REVIEW_MODELS.content,
    contents: [
      {
        parts: [{ inlineData: { mimeType, data: Buffer.from(audio).toString('base64') } }],
      },
    ],
    config: {
      safetySettings: [...NEVER_BLOCK],
      systemInstruction: CONTENT_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: CONTENT_RESPONSE_SCHEMA,
      temperature: 0,
    },
  };
}
