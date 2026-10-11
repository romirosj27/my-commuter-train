import { alertLog, type Db } from '@mct/db';
import { inArray } from '@mct/db/orm';
import type { EmailTransport } from '@mct/email';
import type { EmailJob } from './engine.ts';

/** Sends one alert email and records the provider's message id against its alerts. */
export async function sendAlertEmail(db: Db, transport: EmailTransport, job: EmailJob): Promise<string> {
  const { id } = await transport.send(job.message);
  await db.update(alertLog).set({ emailMessageId: id }).where(inArray(alertLog.id, job.alertIds));
  return id;
}
