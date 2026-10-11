/** Live reference data. FEED-SCHEMA-PLACEHOLDER: authoritative source not yet agreed. */
import type { Operator, ReferenceDataSource, Station, Tiploc } from '@mct/shared';

export class LiveReferenceData implements ReferenceDataSource {
  readonly mode = 'live' as const;
  // eslint-disable-next-line require-yield
  async *stations(): AsyncIterable<Station> {
    throw new Error('Live reference data not implemented: set REFERENCE_MODE=mock');
  }
  // eslint-disable-next-line require-yield
  async *tiplocs(): AsyncIterable<Tiploc> {
    throw new Error('Live reference data not implemented: set REFERENCE_MODE=mock');
  }
  // eslint-disable-next-line require-yield
  async *operators(): AsyncIterable<Operator> {
    throw new Error('Live reference data not implemented: set REFERENCE_MODE=mock');
  }
}
