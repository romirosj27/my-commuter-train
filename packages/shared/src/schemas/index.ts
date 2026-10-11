import { z } from 'zod';

export const crsSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'CRS codes are three letters');

export const tocSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2}$/, 'Operator codes are two characters');

/** HH:MM (24h, London wall-clock). */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const isoWeekdaySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);

export const alertTypes = ['platform_change', 'cancellation', 'delay', 'predicted_disruption'] as const;
export const alertTypeSchema = z.enum(alertTypes);
export type AlertType = z.infer<typeof alertTypeSchema>;

export const timeWindowSchema = z
  .object({ start: localTimeSchema, end: localTimeSchema })
  .refine((w) => w.start !== w.end, { message: 'Window start and end must differ' });

export const commuteInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    homeCrs: crsSchema,
    workCrs: crsSchema,
    outbound: timeWindowSchema,
    return: timeWindowSchema,
    activeDays: z.array(isoWeekdaySchema).min(1).max(7),
    operatorCodes: z.array(tocSchema).max(20).default([]),
    isDefault: z.boolean().default(false),
  })
  .refine((c) => c.homeCrs !== c.workCrs, { message: 'Home and work stations must differ', path: ['workCrs'] });
export type CommuteInput = z.infer<typeof commuteInputSchema>;

export const alertSettingsSchema = z
  .object({
    enabled: z.boolean(),
    types: z.array(alertTypeSchema),
    delayThresholdMin: z.number().int().min(1).max(240),
    quietHours: timeWindowSchema.nullable(),
  });
export type AlertSettingsInput = z.infer<typeof alertSettingsSchema>;

export const stationSchema = z.object({
  crs: crsSchema,
  name: z.string().min(1),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
});
export type Station = z.infer<typeof stationSchema>;

export const tiplocSchema = z.object({
  tiploc: z.string().regex(/^[A-Z0-9]{1,7}$/),
  crs: crsSchema.nullable(),
  name: z.string().min(1),
});
export type Tiploc = z.infer<typeof tiplocSchema>;

export const operatorSchema = z.object({
  code: tocSchema,
  name: z.string().min(1),
  claimUrl: z.string().url().nullable(),
});
export type Operator = z.infer<typeof operatorSchema>;
