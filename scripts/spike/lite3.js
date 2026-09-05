import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { CASES } from '../../tests/fixtures/cases.ts';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const NB = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));
const A = (id) => ({
  inlineData: {
    mimeType: 'audio/wav',
    data: fs
      .readFileSync(
        path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audio', `${id}.wav`),
      )
      .toString('base64'),
  },
});

const SYS = `<role>You judge one spoken recording on three independent questions, and report the
audio quality. You never transcribe it and never repeat its content.</role>

<crisis>
- crisisCanPublish is false when the speaker signals they may harm themselves, want to stop
  living, are giving up on living, or are in immediate personal danger.
- Indirect and understated phrasing counts. People in crisis rarely say it plainly.
- Do NOT require an explicit method, plan, or the word suicide.
- Do NOT return false for grief, burnout, or figures of speech such as "that job was killing me".
Examples: "I lost my mother and can't get out from under it" -> true.
"Everyone would have an easier time if I wasn't around anymore" -> false.
"How do you know when it's time to stop trying? I don't think I want to keep doing this." -> false.
</crisis>

<illegal>
- illegalCanPublish is false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
- Do NOT return false for lawful activity involving weapons, alcohol, money, or risk.
Examples: "Take a hunter safety course and get your license" -> true.
"Buy from a private seller where no background check is required" -> false.
</illegal>

<relevance>
- Only for an answer; return null for a question.
- relevanceCanPublish is true when the answer engages the question, even briefly or badly.
- Do NOT return false because the advice is dangerous, illegal, or offensive. That is the
  illegal judgment's job, and confusing the two makes off-topic indistinguishable from unsafe.
Example: Q "How do I start deer hunting?" A "Buy a gun illegally." -> true. On topic, unlawful.
</relevance>

<audio_quality>
- "clear" when speech is audible and intelligible.
- "unintelligible" when there is sound but the words cannot be made out.
- "silent" when there is no discernible speech at all.
</audio_quality>

<reason>
- primaryReason names the single most serious failing judgment, in the order crisis, illegal,
  relevance; "none" when all pass.
- reasonDetail is one short clause for operators, never shown to anyone. Do NOT quote the
  recording and do NOT include identifying details.
</reason>

<output>JSON matching the schema.</output>`;

const SCHEMA = {
  type: 'object',
  properties: {
    crisisCanPublish: { type: 'boolean' },
    illegalCanPublish: { type: 'boolean' },
    relevanceCanPublish: { type: 'boolean', nullable: true },
    audioQuality: { type: 'string', enum: ['clear', 'unintelligible', 'silent'] },
    primaryReason: { type: 'string', enum: ['none', 'crisis', 'illegal', 'relevance'] },
    reasonDetail: { type: 'string' },
  },
  required: [
    'crisisCanPublish',
    'illegalCanPublish',
    'audioQuality',
    'primaryReason',
    'reasonDetail',
  ],
};

const out = [];
for (const c of CASES) {
  const task =
    c.kind === 'answer'
      ? `The question being answered was: "${c.q}"\n\nJudge the recording above.`
      : `This is a question submission, not an answer. Return null for relevance. Judge the recording above.`;
  const rec = { id: c.id, kind: c.kind, expect: c.expect };
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      const r = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: [{ parts: [A(c.id), { text: task }] }],
        config: {
          safetySettings: NB,
          systemInstruction: SYS,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0,
        },
      });
      rec.ms = Date.now() - t0;
      rec.cand = r.candidates?.length ?? 0;
      rec.parsed = r.text ? JSON.parse(r.text) : null;
      rec.inTok = r.usageMetadata?.promptTokenCount;
      rec.outTok = r.usageMetadata?.candidatesTokenCount;
      break;
    } catch (e) {
      const s = String(e);
      if (s.includes('429') && i < 4) {
        await new Promise((r) => setTimeout(r, 25000 * (i + 1)));
        continue;
      }
      rec.err = s.replace(/\s+/g, ' ').slice(0, 90);
      break;
    }
  }
  out.push(rec);
  process.stderr.write(`  ${c.id}\n`);
  fs.writeFileSync(
    path.join(
      import.meta.dirname,
      '..',
      '..',
      'tests',
      'fixtures',
      'results',
      'merged-judgment-call.json',
    ),
    JSON.stringify(out, null, 2),
  );
  await new Promise((r) => setTimeout(r, 6000));
}
