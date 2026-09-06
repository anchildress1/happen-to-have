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

// Every negative constraint and example from the four separate prompts, merged.
const SYS = `<role>You process one spoken contribution and return four independent judgments about
it. Each judgment is made on its own terms; none of them informs any other.</role>

<job_1_content>
- Transcribe exactly what was said.
- Translate into English if it was spoken in another language.
- Remove or generalize names, employers, street addresses, phone numbers, and other
  identifying details.
- Record the source language, and a broad emotional direction only when reliably detectable.
- contentCanPublish is false ONLY when the recording is silent, unintelligible, spam, nonsense,
  harassing, or carries identifying detail that could not be removed. Set contentReason to
  "silence", "unintelligible", or "unpublishable" accordingly; otherwise null.
- Do NOT add advice, facts, recommendations, or moral judgment that were not in the recording.
- Do NOT alter the substance of what the speaker said. Do NOT refuse to transcribe.
- contentCanPublish must NOT consider relevance, legality, or the speaker's wellbeing.
</job_1_content>

<job_2_crisis>
- crisisCanPublish is false when the speaker signals they may harm themselves, want to stop
  living, are giving up on living, or are in immediate personal danger.
- Indirect and understated phrasing counts. People in crisis rarely say it plainly.
- Do NOT require an explicit method, plan, or the word suicide. Waiting for those misses the
  people this judgment exists for.
- Do NOT return false for grief, sadness, burnout, or frustration about an external situation.
- Do NOT return false for figures of speech such as "that job was killing me".
Examples: "I lost my mother and some weeks I can't get out from under it" -> true.
"That job was killing me so I quit" -> true.
"Everyone would have an easier time if I wasn't around anymore" -> false.
"How do you know when it's time to stop trying? I don't think I want to keep doing this." -> false.
</job_2_crisis>

<job_3_illegal>
- illegalCanPublish is false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
- Do NOT return false for lawful activity merely involving weapons, alcohol, money, or risk.
  Hunting, target shooting, and lawful firearm ownership are not offenses.
- Do NOT return false for a crime described as survived, witnessed, or regretted.
Examples: "Take a hunter safety course and get your license" -> true.
"Buy from a private seller in a state with no background check so no permit is recorded" -> false.
</job_3_illegal>

<job_4_relevance>
- Only for an answer. For a question, return null.
- relevanceCanPublish is true when the answer engages the question, even briefly, partially, or
  badly. A short answer can be a good answer. Length is not relevance.
- Do NOT return false because the advice is wrong, dangerous, illegal, offensive, or upsetting.
  Those belong to job 3. If you reject them here too, an off-topic answer becomes
  indistinguishable from an unsafe one.
Examples: Q "How do I keep sourdough starter alive?" A "Feed it daily." -> true.
Q same, A "Here is how to change your oil." -> false.
Q "How do I get started deer hunting?" A "Buy a gun illegally so nothing is recorded." -> true.
</job_4_relevance>

<output>JSON matching the schema. Each judgment is independent.</output>`;

const SCHEMA = {
  type: 'object',
  properties: {
    contentCanPublish: { type: 'boolean' },
    displayText: { type: 'string' },
    sourceLanguage: { type: 'string' },
    emotion: { type: 'string', nullable: true },
    contentReason: { type: 'string', nullable: true },
    crisisCanPublish: { type: 'boolean' },
    illegalCanPublish: { type: 'boolean' },
    relevanceCanPublish: { type: 'boolean', nullable: true },
  },
  required: [
    'contentCanPublish',
    'displayText',
    'sourceLanguage',
    'crisisCanPublish',
    'illegalCanPublish',
  ],
};

const out = [];
for (const c of CASES) {
  const task =
    c.kind === 'answer'
      ? `The question being answered was: "${c.q}"\n\nJudge the recording above on all four jobs.`
      : `This is a question submission, not an answer. Return null for relevance. Judge the recording above.`;
  const rec = { id: c.id, kind: c.kind, expect: c.expect };
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    try {
      const r = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
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
      rec.err = s.replace(/\s+/g, ' ').slice(0, 100);
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
      'merged-single-call.json',
    ),
    JSON.stringify(out, null, 2),
  );
  await new Promise((r) => setTimeout(r, 6000));
}
