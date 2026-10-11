/**
 * HSP message parsing: wire format → normalised types.
 *
 * FEED-SCHEMA-PLACEHOLDER: not implemented. Message shapes, field names,
 * endpoints and auth must come from the official documentation.
 */
import type { HspServiceSummary } from '@mct/shared';

export function parseHspResponse(_raw: unknown): HspServiceSummary[] {
  throw new Error('HSP parser not implemented: awaiting official schema documentation');
}
