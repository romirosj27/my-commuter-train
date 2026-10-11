/**
 * Delay Repay helper: arrival delay and eligibility for journeys the user
 * says they made. Bands come from an editable per-operator table; every
 * result reminds the user to check the operator's current terms.
 */
import { z } from 'zod';
import { minutesBetween } from './time/index.ts';

export interface DelayRepayBand {
  /** Inclusive lower bound, minutes late at the destination. */
  minMinutes: number;
  /** Exclusive upper bound; null = no upper bound. */
  maxMinutes: number | null;
  /** Percentage of a single ticket's price. */
  singlePct: number;
  /** Percentage of a return ticket's price. */
  returnPct: number;
}

export const delayRepayBandsSchema = z
  .array(
    z.object({
      minMinutes: z.number().int().min(0).max(24 * 60),
      maxMinutes: z.number().int().min(1).max(24 * 60).nullable(),
      singlePct: z.number().min(0).max(100),
      returnPct: z.number().min(0).max(100),
    }),
  )
  .min(1)
  .max(10)
  .superRefine((bands, ctx) => {
    bands.forEach((b, i) => {
      if (b.maxMinutes !== null && b.maxMinutes <= b.minMinutes) {
        ctx.addIssue({ code: 'custom', path: [i, 'maxMinutes'], message: 'Each band must end after it starts' });
      }
      const prev = bands[i - 1];
      if (prev && (prev.maxMinutes === null || prev.maxMinutes > b.minMinutes)) {
        ctx.addIssue({ code: 'custom', path: [i, 'minMinutes'], message: 'Bands must be in order and must not overlap' });
      }
    });
  });

export type TicketType = 'single' | 'return' | 'season';

/** Whole minutes late at the destination (negative = early); null if not known. */
export function arrivalDelayMin(schedArr: Date, actualArr: Date | null): number | null {
  return actualArr ? minutesBetween(schedArr, actualArr) : null;
}

export function bandFor(bands: DelayRepayBand[], delayMin: number): DelayRepayBand | null {
  return bands.find((b) => delayMin >= b.minMinutes && (b.maxMinutes === null || delayMin < b.maxMinutes)) ?? null;
}

export type EligibilityStatus = 'eligible' | 'not_eligible' | 'needs_arrival_time' | 'no_scheme';

export interface Eligibility {
  status: EligibilityStatus;
  delayMin: number | null;
  band: DelayRepayBand | null;
  /** Percentage of the ticket price for this ticket type, if eligible. */
  percent: number | null;
  /** Plain-English summary for the user. */
  message: string;
  /** False while the operator's bands are unverified placeholders. */
  schemeVerified: boolean;
}

export const CHECK_TERMS_NOTE = "Always check the operator's current Delay Repay terms before claiming.";

export function assessEligibility(args: {
  schedArr: Date;
  actualArr: Date | null;
  destCancelled: boolean;
  ticketType: TicketType;
  scheme: { name: string; bands: DelayRepayBand[]; verifiedOn: string | null } | null;
}): Eligibility {
  const verified = !!args.scheme?.verifiedOn;
  const delayMin = arrivalDelayMin(args.schedArr, args.actualArr);
  const base = { delayMin, schemeVerified: verified };
  if (!args.scheme) {
    return { ...base, status: 'no_scheme', band: null, percent: null, message: "We don't have Delay Repay details for this operator yet." };
  }
  if (delayMin === null) {
    return {
      ...base,
      status: 'needs_arrival_time',
      band: null,
      percent: null,
      message: args.destCancelled
        ? "Your train didn't reach your station. Add the time you actually arrived to check eligibility."
        : 'Add the time you actually arrived to check eligibility.',
    };
  }
  const band = bandFor(args.scheme.bands, delayMin);
  if (!band) {
    return {
      ...base,
      status: 'not_eligible',
      band: null,
      percent: null,
      message: delayMin <= 0 ? 'You arrived on time.' : `You arrived ${delayMin} min late, below the first compensation band.`,
    };
  }
  const percent = args.ticketType === 'return' ? band.returnPct : args.ticketType === 'single' ? band.singlePct : null;
  const range = band.maxMinutes === null ? `${band.minMinutes}+ min` : `${band.minMinutes}–${band.maxMinutes - 1} min`;
  return {
    ...base,
    status: 'eligible',
    band,
    percent,
    message:
      args.ticketType === 'season'
        ? `${delayMin} min late (${range} band). Season ticket compensation is worked out from the daily cost of your ticket.`
        : `${delayMin} min late (${range} band): ${percent}% of your ${args.ticketType} ticket.`,
  };
}
