// Idempotent seed loader for seed/questions.json (spec 001-participant-and-pool, T042).
//
// Run via `make seed` -> `node seed/seed.ts`. Node 24 strips TypeScript types natively,
// so this file sticks to erasable syntax only: no enums, no namespaces, no parameter
// properties, no decorators.
//
// ASSUMPTION: src/db/client.ts (owned by another agent) exports a value named `db`
// exposing a node-postgres-style `query(sql, params)` method that resolves to
// `{ rows: T[] }`. The narrow SeedDbClient interface below is this file's own contract
// for that shape — if the real client exports something different, only the import line
// and the cast below need to change.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db as dbClient } from '../src/db/client.ts';

interface SeedDbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface RawSeedQuestion {
  id?: unknown;
  displayText?: unknown;
  sourceLanguage?: unknown;
}

interface SeedQuestion {
  id: string;
  displayText: string;
  sourceLanguage: string;
}

interface SeedFile {
  questions?: unknown;
}

interface UpsertResult {
  inserted: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_DISPLAY_TEXT_LENGTH = 1;
const MAX_DISPLAY_TEXT_LENGTH = 2000;

// `xmax = 0` is the standard Postgres tell for "this RETURNING row came from the INSERT
// branch, not the UPDATE branch" — it distinguishes a fresh insert from a no-op re-seed.
const UPSERT_QUESTION_SQL = `
  INSERT INTO questions (id, participant_id, display_text, source_language, status)
  VALUES ($1, NULL, $2, $3, 'open')
  ON CONFLICT (id) DO UPDATE SET
    display_text = EXCLUDED.display_text,
    source_language = EXCLUDED.source_language,
    status = EXCLUDED.status,
    participant_id = EXCLUDED.participant_id
  RETURNING (xmax = 0) AS inserted
`;

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validateEntry(entry: RawSeedQuestion, index: number): string | null {
  if (!isValidUuid(entry.id)) {
    return `entry ${index}: "id" must be a valid uuid (got ${JSON.stringify(entry.id)})`;
  }
  if (
    typeof entry.displayText !== 'string' ||
    entry.displayText.length < MIN_DISPLAY_TEXT_LENGTH ||
    entry.displayText.length > MAX_DISPLAY_TEXT_LENGTH
  ) {
    return `entry ${index} (${entry.id}): "displayText" must be a string of ${MIN_DISPLAY_TEXT_LENGTH}-${MAX_DISPLAY_TEXT_LENGTH} characters`;
  }
  if (typeof entry.sourceLanguage !== 'string' || entry.sourceLanguage.length === 0) {
    return `entry ${index} (${entry.id}): "sourceLanguage" must be a non-empty string`;
  }
  return null;
}

function loadSeedFile(seedPath: string): SeedQuestion[] {
  let raw: string;
  try {
    raw = readFileSync(seedPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read seed file at ${seedPath}: ${(err as Error).message}`);
  }

  let parsed: SeedFile;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Seed file at ${seedPath} is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed.questions)) {
    throw new Error(`Seed file at ${seedPath} is malformed: expected a "questions" array.`);
  }

  const rawEntries = parsed.questions as RawSeedQuestion[];
  const validEntries: SeedQuestion[] = [];
  const invalidReasons: string[] = [];

  rawEntries.forEach((entry, index) => {
    const reason = validateEntry(entry ?? {}, index);
    if (reason) {
      invalidReasons.push(reason);
      return;
    }
    validEntries.push(entry as SeedQuestion);
  });

  if (invalidReasons.length > 0) {
    console.error('Seed file contains malformed entries:');
    for (const reason of invalidReasons) {
      console.error(`  - ${reason}`);
    }
    throw new SkippedEntriesError(invalidReasons.length, validEntries);
  }

  return validEntries;
}

class SkippedEntriesError extends Error {
  skippedCount: number;
  validEntries: SeedQuestion[];

  constructor(skippedCount: number, validEntries: SeedQuestion[]) {
    super(`${skippedCount} seed entr${skippedCount === 1 ? 'y' : 'ies'} failed validation`);
    this.skippedCount = skippedCount;
    this.validEntries = validEntries;
  }
}

function printSummary(inserted: number, alreadyPresent: number, skipped: number): void {
  console.log('Seed summary:');
  console.log(`  inserted:        ${inserted}`);
  console.log(`  already present: ${alreadyPresent}`);
  console.log(`  skipped:         ${skipped}`);
}

async function upsertQuestions(client: SeedDbClient, questions: SeedQuestion[]) {
  let inserted = 0;
  let alreadyPresent = 0;

  for (const question of questions) {
    const result = await client.query<UpsertResult>(UPSERT_QUESTION_SQL, [
      question.id,
      question.displayText,
      question.sourceLanguage,
    ]);
    if (result.rows[0]?.inserted) {
      inserted += 1;
    } else {
      alreadyPresent += 1;
    }
  }

  return { inserted, alreadyPresent };
}

async function main(): Promise<void> {
  const seedPath = join(import.meta.dirname, 'questions.json');
  const client = dbClient as unknown as SeedDbClient;

  let validEntries: SeedQuestion[];
  let skippedCount = 0;

  try {
    validEntries = loadSeedFile(seedPath);
  } catch (err) {
    if (err instanceof SkippedEntriesError) {
      validEntries = err.validEntries;
      skippedCount = err.skippedCount;
    } else {
      throw err;
    }
  }

  const { inserted, alreadyPresent } = await upsertQuestions(client, validEntries);

  printSummary(inserted, alreadyPresent, skippedCount);

  if (skippedCount > 0) {
    throw new Error(
      `Seed run failed: ${skippedCount} malformed entr${skippedCount === 1 ? 'y' : 'ies'} in questions.json. See details above.`,
    );
  }
}

main()
  .then(() => {
    console.log('Seed run completed successfully.');
  })
  .catch((err) => {
    console.error(`Seeding failed: ${(err as Error).message}`);
    process.exitCode = 1;
  });
