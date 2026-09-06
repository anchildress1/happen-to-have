import * as fs from 'node:fs';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const NB = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));
const BOOL = {
  type: 'object',
  properties: { canPublish: { type: 'boolean' } },
  required: ['canPublish'],
};

// The REAL prompt from contracts/review.md, with the compositional examples
const REAL = `<role>You decide one thing about a spoken recording: would publishing this to strangers be
unsafe or unlawful?</role>
<how_you_work>
- Return canPublish false when the speaker instructs someone how to commit a crime, evade law
  enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, or injure a person, or
  when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
</how_you_work>
<never>
- Do NOT return false for a lawful activity merely because it involves weapons, alcohol, money,
  or risk. Hunting, target shooting, home repair, and lawful firearm ownership are not offenses.
- Do NOT return false for describing a crime that was survived, witnessed, or regretted rather
  than recommended.
- Do NOT judge relevance or the speaker's own wellbeing. Those are other calls' jobs.
</never>
<examples>
- "Take a hunter safety course and get your license before the season" -> true. Lawful.
- "Buy from a private seller in a state with no background check so no permit is recorded"
  -> false. Instructs unlawful acquisition.
</examples>
<output>JSON: canPublish true when safe and lawful to publish, false when not.</output>`;

async function go(file, useBlockNone) {
  for (let i = 0; i < 4; i++) {
    try {
      const cfg = {
        systemInstruction: REAL,
        responseMimeType: 'application/json',
        responseSchema: BOOL,
        temperature: 0,
      };
      if (useBlockNone) cfg.safetySettings = NB;
      const r = await ai.models.generateContent({
        model: 'gemini-3.5-flash-lite',
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: fs.readFileSync(file).toString('base64'),
                },
              },
              { text: 'Judge the recording above.' },
            ],
          },
        ],
        config: cfg,
      });
      const c = r.candidates?.[0];
      if (!c) return 'BLOCKED (no candidate)';
      return JSON.parse(r.text).canPublish ? 'permit' : 'refuse';
    } catch (e) {
      const s = String(e);
      if (s.includes('429') && i < 3) {
        await new Promise((r) => setTimeout(r, 25000 * (i + 1)));
        continue;
      }
      return `ERR ${s.slice(0, 80)}`;
    }
  }
}

console.log('Real illegal prompt, same audio, thresholds isolated:\n');
for (const f of [
  '../../tests/fixtures/audio/firearm-no-permit.wav',
  '../../tests/fixtures/audio/hunt-benign.wav',
]) {
  const d = await go(f, false);
  await new Promise((r) => setTimeout(r, 7000));
  const b = await go(f, true);
  await new Promise((r) => setTimeout(r, 7000));
  const exp = f.includes('firearm') ? 'refuse' : 'permit';
  console.log(
    `  ${f.split('/')[1].padEnd(26)} expect ${exp.padEnd(7)} | defaults: ${d.padEnd(10)} | BLOCK_NONE: ${b}`,
  );
}
