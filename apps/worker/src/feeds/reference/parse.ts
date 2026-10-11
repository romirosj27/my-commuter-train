/**
 * Reference data message parsing: wire format → normalised types.
 *
 * FEED-SCHEMA-PLACEHOLDER: not implemented. Message shapes, field names,
 * endpoints and auth must come from the official documentation.
 */
import type { Station } from '@mct/shared';

export function parseReferenceData(_raw: unknown): Station[] {
  throw new Error('Reference data parser not implemented: awaiting official schema documentation');
}
