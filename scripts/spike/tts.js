import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { CASES } from '../../tests/fixtures/cases.ts';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const DIR = path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'audio');
// *.wav is gitignored and git does not keep empty directories, so a clean checkout has no
// audio directory at all. Without this, every TTS request succeeds, is billed, and then throws
// ENOENT on write — which the retry wrapper reads as a provider fault and repeats five times.
fs.mkdirSync(DIR, { recursive: true });
function wav(pcm, rate = 24000, bits = 16, ch = 1) {
  const h = Buffer.alloc(44),
    br = (rate * ch * bits) / 8;
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
for (const c of CASES) {
  const f = path.join(DIR, `${c.id}.wav`);
  if (fs.existsSync(f)) continue;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await ai.models.generateContent({
        model: 'gemini-3.1-flash-tts-preview',
        contents: [
          { parts: [{ text: `Say this naturally, like someone talking to a friend: ${c.text}` }] },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      });
      const b64 = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
      if (!b64) throw new Error('no audio returned');
      fs.writeFileSync(f, wav(Buffer.from(b64, 'base64')));
      console.log('  wrote', c.id);
      break;
    } catch (e) {
      if (i === 5) {
        console.log('  FAILED', c.id, String(e).slice(0, 100));
        break;
      }
      await new Promise((r) => setTimeout(r, 25000 * (i + 1)));
    }
  }
  await new Promise((r) => setTimeout(r, 8000));
}
