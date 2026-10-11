/**
 * Incidents message parsing: wire format → normalised types.
 *
 * FEED-SCHEMA-PLACEHOLDER: not implemented. Message shapes, field names,
 * endpoints and auth must come from the official documentation.
 */
import type { Incident } from '@mct/shared';

export function parseIncidents(_raw: unknown): Incident[] {
  throw new Error('Incidents parser not implemented: awaiting official schema documentation');
}
