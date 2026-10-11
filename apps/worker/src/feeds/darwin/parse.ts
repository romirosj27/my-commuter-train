/**
 * Darwin message parsing: wire format → normalised DarwinEvent.
 *
 * FEED-SCHEMA-PLACEHOLDER: not implemented. The message schema, field names,
 * association category codes, reason-code lookups and time/rollover rules
 * must come from the official Darwin documentation and XSDs. Nothing here
 * should be written from memory.
 */
import type { DarwinEvent } from '@mct/shared';

export function parseDarwinMessage(_raw: Buffer | string): DarwinEvent[] {
  throw new Error('Darwin parser not implemented: awaiting official schema documentation');
}
