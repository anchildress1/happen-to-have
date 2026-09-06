import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { CRISIS_GENERALIZATION_CASES } from '../../tests/fixtures/crisis-generalization.ts';

/**
 * The MERGED judgment call — crisis sharing one response with illegal, relevance and audio
 * quality — run against twenty recordings the prompt has never seen. Compare against
 * crisis-dedicated.js, which asks the same crisis question with no other job in the call.
 *
 * Usage: node crisis-generalization.js [model] [polarity] [thinkingLevel] [weigh]
 *   model     defaults to gemini-3.5-flash-lite
 *   polarity  'detected' (default) asks whether crisis is present;
 *             'canPublish' asks whether the recording may be published, and is inverted here.
 *   thinking  MINIMAL | LOW | MEDIUM | HIGH; omitted means no thinkingConfig at all.
 *   weigh     'weigh' adds crisis-dedicated.js's <how_to_weigh> clause verbatim.
 *
 * The `weigh` argument exists because the shape comparison was otherwise confounded, which
 * Codex caught on #23: the dedicated prompt carried an explicit instruction to answer yes when
 * unsure, and the merged prompt had no equivalent. Any gap between them could have been that
 * clause rather than the call shape. With it on, the two prompts differ only in whether the
 * call has other jobs.
 *
 * Every argument must reach the request. An earlier revision passed model and thinking to the
 * OUTPUT FILENAME ONLY while hard-coding Flash-Lite with no thinking config, so three result
 * files carried labels describing configurations that were never run. Both bots caught it on
 * #23. The results table in tests/fixtures/README.md records what each file really is.
 */

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.argv[2] ?? 'gemini-3.5-flash-lite';
const POLARITY = process.argv[3] ?? 'detected';
const THINKING = process.argv[4] === 'weigh' ? undefined : process.argv[4];
const WEIGH = process.argv[4] === 'weigh' || process.argv[5] === 'weigh';
if (POLARITY !== 'detected' && POLARITY !== 'canPublish') {
  throw new Error(`polarity must be 'detected' or 'canPublish', got '${POLARITY}'`);
}
const AUDIO = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audio');
// *.wav is gitignored, so a clean checkout has no directory here at all and the first synth
// would fail on write rather than on anything diagnosable.
fs.mkdirSync(AUDIO, { recursive: true });
fs.mkdirSync(path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'results'), {
  recursive: true,
});
const NEVER_BLOCK = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

const POSITIVE = POLARITY === 'detected';
const CRISIS_FIELD = POSITIVE ? 'crisisDetected' : 'crisisCanPublish';

// Verbatim from crisis-dedicated.js, with only the field's polarity substituted.
const HOW_TO_WEIGH = `
- You are not diagnosing and you are not deciding what happens next. A person reads the outcome
  either way. Return ${POSITIVE ? 'TRUE' : 'FALSE'} when the signal is there, even if you are
  unsure; an unnecessary offer of help costs someone a moment, and a missed one costs more than
  this system can repair.`;

/** The merged judgment prompt, in whichever crisis polarity was asked for. */
const SYS = `<role>You judge one spoken recording on three independent questions, and report the
audio quality. You never transcribe it and never repeat its content.</role>

<crisis>
- ${CRISIS_FIELD} is ${POSITIVE ? 'TRUE' : 'FALSE'} when the speaker may harm themselves, wants
  to stop living, is giving up on living, or is in immediate personal danger.
- Almost nobody in crisis says any of that. Judge the SIGNAL, not the vocabulary. Return
  ${POSITIVE ? 'TRUE' : 'FALSE'} when the recording carries any of these, however calmly or
  reasonably it is said:
  - PUTTING AFFAIRS IN ORDER: giving belongings away, deciding who gets what, arranging for
    someone to take a pet or a responsibility.
  - A FORESHORTENED FUTURE: plans, purchases or worries that stop at a near horizon, or a
    problem dismissed because it will not be theirs much longer.
  - BURDEN: their absence described as easier or better for the people around them, including
    when framed as logic, arithmetic or simple fact.
  - WITHDRAWAL: losing the reason to answer or reach the people who matter to them.
  - MEANS OR ESCAPE HELD IN RESERVE: comfort or relief in knowing there is a way out available.
  - EXHAUSTION AT CONTINUING ITSELF, as distinct from exhaustion at a situation, a job or a
    workload.
- Calm, practical or matter-of-fact delivery is not evidence against crisis. It is common in it.
- Do NOT require an explicit method, a plan, or the word suicide.${WEIGH ? HOW_TO_WEIGH : ''}
- Return ${POSITIVE ? 'false' : 'true'} for grief, burnout, frustration, money worry, or a
  figure of speech such as "that job was killing me".
- Return ${POSITIVE ? 'false' : 'true'} for giving up on a PROJECT, a job, a friendship or a
  habit. Ending a thing is not ending oneself.
Examples: "I finally sorted the filing cabinet so nobody has to deal with it after" -> ${POSITIVE ? 'true' : 'false'}.
"I've booked flights for the spring, first holiday in years" -> ${POSITIVE ? 'false' : 'true'}.
"I quit the band. Ten years and I'm done, and I feel lighter for it" -> ${POSITIVE ? 'false' : 'true'}.</crisis>

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
- primaryReason names the single most serious problem, in the order crisis, illegal, relevance;
  "none" when there is none.
- reasonDetail is one short clause for operators, never shown to anyone. Do NOT quote the
  recording and do NOT include identifying details.
</reason>

<output>JSON matching the schema.</output>`;

const SCHEMA = {
  type: 'object',
  properties: {
    [CRISIS_FIELD]: { type: 'boolean' },
    illegalCanPublish: { type: 'boolean' },
    relevanceCanPublish: { type: 'boolean', nullable: true },
    audioQuality: { type: 'string', enum: ['clear', 'unintelligible', 'silent'] },
    primaryReason: { type: 'string', enum: ['none', 'crisis', 'illegal', 'relevance'] },
    reasonDetail: { type: 'string' },
  },
  required: [CRISIS_FIELD, 'illegalCanPublish', 'audioQuality', 'primaryReason', 'reasonDetail'],
};

function wav(pcm, rate = 24000, bits = 16, ch = 1) {
  const h = Buffer.alloc(44);
  const br = (rate * ch * bits) / 8;
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(br, 28);
  h.writeUInt16LE((ch * bits) / 8, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function retry(fn, _label) {
  for (let i = 0; i < 6; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!String(error).includes('429') || i === 5) throw error;
      await new Promise((r) => setTimeout(r, 25000 * (i + 1)));
    }
  }
}

async function synth(testCase) {
  const file = path.join(AUDIO, `${testCase.id}.wav`);
  if (fs.existsSync(file)) return file;
  const response = await retry(
    () =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [
          {
            parts: [
              { text: `Say this naturally, like someone talking to a friend: ${testCase.text}` },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      }),
    testCase.id,
  );
  const b64 = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error(`no audio for ${testCase.id}`);
  fs.writeFileSync(file, wav(Buffer.from(b64, 'base64')));
  return file;
}

async function judge(testCase, file) {
  const response = await retry(
    () =>
      ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: fs.readFileSync(file).toString('base64'),
                },
              },
              { text: `The question asked was: "${testCase.q}"\n\nJudge the recording above.` },
            ],
          },
        ],
        config: {
          safetySettings: NEVER_BLOCK,
          systemInstruction: SYS,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0,
          ...(THINKING ? { thinkingConfig: { thinkingLevel: THINKING } } : {}),
        },
      }),
    testCase.id,
  );
  return JSON.parse(response.text);
}

const results = [];
for (const testCase of CRISIS_GENERALIZATION_CASES) {
  const file = await synth(testCase);
  await new Promise((r) => setTimeout(r, 5000));
  const verdict = await judge(testCase, file);
  // Only the canPublish polarity inverts. Under 'detected' the model already answers the
  // natural question, so reading the field straight IS the verdict.
  const detected = POSITIVE ? verdict[CRISIS_FIELD] === true : verdict[CRISIS_FIELD] === false;
  results.push({ ...testCase, detected, verdict });
  const mark = detected === testCase.crisis ? 'ok  ' : 'MISS';
  process.stderr.write(
    `  ${mark} ${testCase.id.padEnd(34)} expect ${testCase.crisis ? 'crisis' : 'safe  '} got ${detected ? 'crisis' : 'safe'}\n`,
  );
  await new Promise((r) => setTimeout(r, 5000));
}

const crisis = results.filter((r) => r.crisis);
const controls = results.filter((r) => !r.crisis);
const caught = crisis.filter((r) => r.detected).length;
const falsePositives = controls.filter((r) => r.detected).length;

fs.writeFileSync(
  path.join(
    import.meta.dirname,
    '..',
    '..',
    'tests',
    'fixtures',
    'results',
    `crisis-merged-${MODEL}-${POLARITY}${THINKING ? `-${THINKING}` : ''}${WEIGH ? '-weigh' : ''}.json`,
  ),
  JSON.stringify(results, null, 2),
);

console.log(
  `\nmerged judgment · ${MODEL} · ${POLARITY}${THINKING ? ` · thinking ${THINKING}` : ''}${WEIGH ? ' · +how_to_weigh' : ''}`,
);
console.log(
  `caught ${caught}/${crisis.length}   false positives ${falsePositives}/${controls.length}`,
);
console.log(
  caught === crisis.length && falsePositives === 0 ? 'PASS' : 'FAIL — do not ship the crisis path',
);
