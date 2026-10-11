import { addDays, toLondon, type DarwinEvent, type Incident, type NetworkEvent } from '@mct/shared';
import { compileScenario, loadScenarios, scenarioRunsOn, type CompiledScenario, type Scenario } from './scenario.ts';

/**
 * Compiles scenarios per London date (cached), so the mocks replay the same
 * fixtures every day. `only` restricts to named scenarios (MOCK_SCENARIO).
 */
export class ScenarioLibrary {
  private cache = new Map<string, CompiledScenario[]>();

  constructor(private readonly scenarios: Scenario[]) {}

  static async load(only?: string): Promise<ScenarioLibrary> {
    const all = await loadScenarios();
    const names = only && only !== 'all' ? new Set(only.split(',').map((s) => s.trim())) : null;
    const chosen = names ? all.filter((s) => names.has(s.name)) : all;
    if (names && chosen.length !== names.size) {
      const missing = [...names].filter((n) => !all.some((s) => s.name === n));
      throw new Error(`Unknown mock scenario(s): ${missing.join(', ')}`);
    }
    return new ScenarioLibrary(chosen);
  }

  get names(): string[] {
    return this.scenarios.map((s) => s.name);
  }

  forDate(date: string): CompiledScenario[] {
    let compiled = this.cache.get(date);
    if (!compiled) {
      compiled = this.scenarios.filter((s) => scenarioRunsOn(s, date)).map((s) => compileScenario(s, date));
      this.cache.set(date, compiled);
    }
    return compiled;
  }

  /** London dates whose fixtures are "live" around an instant: yesterday (late services), today, tomorrow. */
  datesAround(now: Date): string[] {
    const today = toLondon(now).date;
    return [addDays(today, -1), today, addDays(today, 1)];
  }

  darwinEvents(dates: string[]): DarwinEvent[] {
    return dates.flatMap((d) => this.forDate(d).flatMap((c) => c.darwin)).sort((a, b) => a.at.localeCompare(b.at));
  }

  networkEvents(dates: string[]): NetworkEvent[] {
    return dates.flatMap((d) => this.forDate(d).flatMap((c) => c.network)).sort((a, b) => a.at.localeCompare(b.at));
  }

  incidents(dates: string[]): Incident[] {
    return dates.flatMap((d) => this.forDate(d).flatMap((c) => c.incidents));
  }
}
