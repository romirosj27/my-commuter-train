/**
 * Loads mock scenario fixtures from disk. The format and compiler live in
 * @mct/shared/mock (browser-safe, also used by the web demo).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenarioSchema, type Scenario } from '@mct/shared/mock';

export * from '@mct/shared/mock';

export const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL('../../../../../fixtures/scenarios', import.meta.url));

export async function loadScenarios(dir = process.env.FIXTURES_DIR ?? DEFAULT_FIXTURES_DIR): Promise<Scenario[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(
    files.map(async (f) => {
      const raw: unknown = JSON.parse(await readFile(join(dir, f), 'utf8'));
      const parsed = scenarioSchema.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid scenario ${f}: ${parsed.error.message}`);
      return parsed.data;
    }),
  );
}
