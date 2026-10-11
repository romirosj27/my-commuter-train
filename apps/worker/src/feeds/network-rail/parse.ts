/**
 * Network Rail (TRUST/TD) message parsing: wire format → normalised types.
 *
 * FEED-SCHEMA-PLACEHOLDER: not implemented. Message shapes, field names,
 * endpoints and auth must come from the official documentation.
 */
import type { NetworkEvent } from '@mct/shared';

export function parseNetworkRailMessage(_raw: unknown): NetworkEvent[] {
  throw new Error('Network Rail (TRUST/TD) parser not implemented: awaiting official schema documentation');
}
