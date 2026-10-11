import { demoOperators, demoStations, demoTiplocs, type ReferenceDataSource } from '@mct/shared';

/** Serves the hand-entered (unverified) demo reference data. */
export class MockReferenceData implements ReferenceDataSource {
  readonly mode = 'mock' as const;
  async *stations() {
    yield* demoStations;
  }
  async *tiplocs() {
    yield* demoTiplocs;
  }
  async *operators() {
    yield* demoOperators;
  }
}
