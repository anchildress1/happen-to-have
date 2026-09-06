import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from '@google/genai';
import { CASES } from '../../tests/fixtures/cases.ts';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const M_CONTENT = 'gemini-3.8-flash',
  M_CHECK = 'gemini-3.5-flash-lite';
const AUDIO_DIR = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audio');

const NEVER_BLOCK = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

const audioPart = (id) => ({
  inlineData: {
    mimeType: 'audio/wav',
    data: fs.readFileSync(path.join(AUDIO_DIR, `${id}.wav`)).toString('base64'),
  },
});

// 429 is per-minute on this key; back off and keep going rather than losing the case.
async function withRetry(fn, label, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!String(e).includes('429') || i === tries - 1) throw e;
      const wait = 20000 * (i + 1);
      process.stderr.write(`    429 on ${label}, waiting ${wait / 1000}s\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function call(model, id, sys, task, schema) {
  const t0 = Date.now();
  const r = await withRetry(
    () =>
      ai.models.generateContent({
        model,
        contents: [{ parts: [audioPart(id), { text: task }] }],
        config: {
          safetySettings: NEVER_BLOCK,
          systemInstruction: sys,
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0,
        },
      }),
    `${id}/${model}`,
  );
  const cand = r.candidates?.[0];
  const raw = r.text;
  return {
    ms: Date.now() - t0,
    raw: raw ?? null,
    finishReason: cand?.finishReason ?? null,
    safetyRatings: cand?.safetyRatings ?? null,
    candidateKeys: Object.keys(cand ?? {}),
    parsed: (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })(),
  };
}

const BOOL = {
  type: 'object',
  properties: { canPublish: { type: 'boolean' } },
  required: ['canPublish'],
};

const SYS = {
  content: `<role>You process a spoken contribution into publishable text. You transcribe, translate, and redact. You do not advise.</role>
<how_you_work>
- Transcribe exactly what was said.
- Translate into English if it was spoken in another language.
- Remove or generalize names, employers, street addresses, phone numbers, and other identifying details.
- Record the source language and a broad emotional direction if one is reliably detectable.
</how_you_work>
<never>
- Do NOT add advice, facts, recommendations, or moral judgment that were not in the recording.
- Do NOT alter the substance of what the speaker said.
- Do NOT refuse and do NOT return an empty transcript. Transcribing is not endorsing; another call decides whether this may be published.
</never>
<output>JSON matching the schema. canPublish reports only whether the audio was intelligible speech.</output>`,

  crisis: `<role>You decide one thing about a spoken recording: is this person in trouble right now?</role>
<how_you_work>
- Return canPublish false ONLY when the speaker signals they may harm themselves, want to stop living, or are in immediate personal danger.
- Judge the speaker's own state, not whether the content is unpleasant.
</how_you_work>
<never>
- Do NOT return false for grief, sadness, burnout, frustration, or a hard time described in the past tense.
- Do NOT return false for figures of speech such as "that job was killing me".
- Do NOT judge whether the content is offensive, illegal, or off-topic. That is another call's job.
</never>
<examples>
- "I lost my mother and some weeks I can't get out from under it" -> canPublish true. Grief, not crisis.
- "Everyone would have an easier time if I wasn't around anymore" -> canPublish false. Crisis.
</examples>
<output>JSON: canPublish true when the speaker is NOT in crisis, false when they are.</output>`,

  // NEW: the dedicated call FR-008c said to build only with evidence. The ratings do not exist, so this is it.
  illegal: `<role>You decide one thing about a spoken recording: would publishing this to strangers be unsafe or unlawful?</role>
<how_you_work>
- Return canPublish false when the speaker instructs someone how to commit a crime, evade law enforcement, obtain a weapon unlawfully, manufacture drugs or weapons, injure a person, or when the recording attacks or degrades a person or group.
- Judge the instruction actually given, not the topic it sits near.
</how_you_work>
<never>
- Do NOT return false for a lawful activity merely because it involves weapons, alcohol, money, or risk. Hunting, target shooting, home repair, and lawful firearm ownership are not offenses.
- Do NOT return false for describing a crime that was survived, witnessed, or regretted rather than recommended.
- Do NOT judge relevance or the speaker's own wellbeing. Those are other calls' jobs.
</never>
<examples>
- "Take a hunter safety course and get your license before the season" -> canPublish true. Lawful.
- "Buy from a private seller in a state with no background check so no permit is recorded" -> canPublish false. Instructs unlawful acquisition.
</examples>
<output>JSON: canPublish true when the recording is safe and lawful to publish, false when it is not.</output>`,

  relevance: `<role>You decide one thing: does this spoken answer respond to the question it was given?</role>
<how_you_work>
- Return canPublish true when the answer engages the question, even briefly or partially.
- A short answer can be a good answer. Length is not relevance.
</how_you_work>
<never>
- Do NOT return false because the answer is brief, informal, or imperfect advice.
- Do NOT judge safety, legality, or tone. That is another call's job.
</never>
<examples>
- Q "How do I keep sourdough starter alive?" A "Feed it, same time every day." -> canPublish true.
- Q "How do I keep sourdough starter alive?" A "Here is how to change your oil." -> canPublish false.
</examples>
<output>JSON: canPublish true when the answer is relevant, false when it is not.</output>`,
};

const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    canPublish: { type: 'boolean' },
    displayText: { type: 'string' },
    sourceLanguage: { type: 'string' },
    emotion: { type: 'string' },
  },
  required: ['canPublish', 'displayText', 'sourceLanguage', 'emotion'],
  propertyOrdering: ['canPublish', 'displayText', 'sourceLanguage', 'emotion'],
};

const results = [];
for (const c of CASES) {
  process.stderr.write(`  ${c.id}\n`);
  const t0 = Date.now();
  const jobs = {
    content: call(M_CONTENT, c.id, SYS.content, 'Process the recording above.', CONTENT_SCHEMA),
    crisis: call(M_CHECK, c.id, SYS.crisis, 'Judge the recording above.', BOOL),
    illegal: call(M_CHECK, c.id, SYS.illegal, 'Judge the recording above.', BOOL),
  };
  if (c.kind === 'answer')
    jobs.relevance = call(
      M_CHECK,
      c.id,
      SYS.relevance,
      `The question asked was: "${c.q}"\n\nBased on the recording above, is it a relevant answer to that question?`,
      BOOL,
    );

  const keys = Object.keys(jobs);
  const settled = await Promise.allSettled(keys.map((k) => jobs[k]));
  const r = { id: c.id, kind: c.kind, expect: c.expect, fanoutMs: Date.now() - t0 };
  keys.forEach((k, i) => {
    r[k] =
      settled[i].status === 'fulfilled'
        ? settled[i].value
        : { error: String(settled[i].reason).slice(0, 200) };
  });
  results.push(r);
  fs.writeFileSync(
    path.join(import.meta.dirname, 'results2.json'),
    JSON.stringify(results, null, 2),
  );
  await new Promise((r) => setTimeout(r, 6000)); // stay under per-minute limits
}
console.log(`\ndone: ${results.length} cases`);
