import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { CRISIS_GENERALIZATION_CASES } from '../../tests/fixtures/crisis-generalization.ts';

/** Crisis alone, no other job in the call. Tests whether merging is what lost the signal. */
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.argv[2] ?? 'gemini-3.5-flash-lite';
const AUDIO = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audio');
// Matches crisis-generalization.js's naming so a second voice can be judged without
// regenerating or clobbering the Kore baseline.
const VOICE = process.env.VOICE ?? 'Kore';
const NEVER_BLOCK = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

const SYS = `<role>You listen to one recording and answer a single question: is this person in
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

const SCHEMA = {
  type: 'object',
  properties: {
    inTrouble: { type: 'boolean' },
    signal: { type: 'string' },
  },
  required: ['inTrouble', 'signal'],
};

async function retry(fn) {
  for (let i = 0; i < 6; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!String(error).includes('429') || i === 5) throw error;
      await new Promise((r) => setTimeout(r, 25000 * (i + 1)));
    }
  }
}

const results = [];
for (const testCase of CRISIS_GENERALIZATION_CASES) {
  const file = path.join(
    AUDIO,
    VOICE === 'Kore' ? `${testCase.id}.wav` : `${testCase.id}.${VOICE}.wav`,
  );
  const response = await retry(() =>
    ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          parts: [
            {
              inlineData: { mimeType: 'audio/wav', data: fs.readFileSync(file).toString('base64') },
            },
          ],
        },
      ],
      config: {
        safetySettings: NEVER_BLOCK,
        systemInstruction: SYS,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        temperature: 0,
      },
    }),
  );
  const verdict = JSON.parse(response.text);
  const detected = verdict.inTrouble === true;
  results.push({ ...testCase, detected, verdict });
  process.stderr.write(
    `  ${detected === testCase.crisis ? 'ok  ' : 'MISS'} ${testCase.id.padEnd(34)} ${detected ? 'crisis' : 'safe  '}  ${String(verdict.signal).slice(0, 34)}\n`,
  );
  await new Promise((r) => setTimeout(r, 4000));
}

const crisis = results.filter((r) => r.crisis);
const controls = results.filter((r) => !r.crisis);
const caught = crisis.filter((r) => r.detected).length;
const fp = controls.filter((r) => r.detected).length;
fs.writeFileSync(
  path.join(
    import.meta.dirname,
    '..',
    '..',
    'tests',
    'fixtures',
    'results',
    `crisis-dedicated-${MODEL}${VOICE === 'Kore' ? '' : `-${VOICE}`}.json`,
  ),
  JSON.stringify(results, null, 2),
);
console.log(
  `\nmodel ${MODEL} (dedicated call)\ncaught ${caught}/${crisis.length}   false positives ${fp}/${controls.length}`,
);
console.log(caught === crisis.length && fp === 0 ? 'PASS' : 'FAIL');
