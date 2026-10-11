/**
 * Demo users and commutes (idempotent). Passwords are hashed the same way
 * Better Auth hashes them, and emails are pre-verified.
 *
 *   demo@example.com      / demo-password-123   NCL⇄YRK (default) and DAR⇄LDS
 *   commuter@example.com  / demo-password-123   YRK⇄NCL, TP and GR only, 10-minute threshold
 */
import { randomUUID } from 'node:crypto';
import { account, alertSettings, commutes, createDb, user, type Db } from '@mct/db';
import { eq } from '@mct/db/orm';
import { DEFAULT_ALERT_SETTINGS, weekdayMask } from '@mct/shared';
import { hashPassword } from 'better-auth/crypto';
import { newUnsubscribeToken } from './services/commutes.ts';

const PASSWORD = 'demo-password-123';

interface DemoCommute {
  name: string;
  home: string;
  work: string;
  outbound: [string, string];
  ret: [string, string];
  operators?: string[];
  threshold?: number;
  isDefault?: boolean;
}

const demoUsers: Array<{ email: string; name: string; commutes: DemoCommute[] }> = [
  {
    email: 'demo@example.com',
    name: 'Demo Commuter',
    commutes: [
      { name: 'Office', home: 'NCL', work: 'YRK', outbound: ['07:00', '09:30'], ret: ['17:00', '19:00'], isDefault: true },
      { name: 'Leeds site', home: 'DAR', work: 'LDS', outbound: ['07:30', '09:00'], ret: ['16:30', '18:30'] },
    ],
  },
  {
    email: 'commuter@example.com',
    name: 'Second Commuter',
    commutes: [
      { name: 'Newcastle office', home: 'YRK', work: 'NCL', outbound: ['06:30', '08:30'], ret: ['17:00', '19:00'], operators: ['TP', 'GR'], threshold: 10, isDefault: true },
    ],
  },
];

export async function seedDemo(db: Db): Promise<void> {
  const hash = await hashPassword(PASSWORD);
  for (const u of demoUsers) {
    const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, u.email));
    if (existing) continue;
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(user).values({ id, email: u.email, name: u.name, emailVerified: true });
      await tx.insert(account).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: hash });
      for (const c of u.commutes) {
        const [row] = await tx
          .insert(commutes)
          .values({
            userId: id,
            name: c.name,
            homeCrs: c.home,
            workCrs: c.work,
            outboundStart: c.outbound[0],
            outboundEnd: c.outbound[1],
            returnStart: c.ret[0],
            returnEnd: c.ret[1],
            activeDays: weekdayMask([1, 2, 3, 4, 5]),
            operatorCodes: c.operators ?? [],
            isDefault: c.isDefault ?? false,
          })
          .returning({ id: commutes.id });
        await tx.insert(alertSettings).values({
          commuteId: row!.id,
          unsubscribeToken: newUnsubscribeToken(),
          enabled: true,
          types: DEFAULT_ALERT_SETTINGS.types,
          delayThresholdMin: c.threshold ?? DEFAULT_ALERT_SETTINGS.delayThresholdMin,
        });
      }
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = createDb();
  try {
    await seedDemo(h.db);
    console.log(`demo users ready (password: ${PASSWORD})`);
  } finally {
    await h.close();
  }
}
