/**
 * Commute form state ↔ API payloads. Validation reuses the shared zod schema
 * so the browser and API agree on what is valid.
 */
import { alertTypes, commuteInputSchema, type AlertType, type CommuteDto, type CommuteInput } from '@mct/shared';
import type { Station } from '@/lib/queries';

export interface CommuteFormValues {
  name: string;
  home: Station | null;
  work: Station | null;
  outboundStart: string;
  outboundEnd: string;
  returnStart: string;
  returnEnd: string;
  activeDays: number[];
  operatorCodes: string[];
  isDefault: boolean;
  alertsEnabled: boolean;
  alertTypes: AlertType[];
  delayThresholdMin: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

export const emptyCommuteForm: CommuteFormValues = {
  name: 'My commute',
  home: null,
  work: null,
  outboundStart: '07:00',
  outboundEnd: '09:00',
  returnStart: '17:00',
  returnEnd: '19:00',
  activeDays: [1, 2, 3, 4, 5],
  operatorCodes: [],
  isDefault: false,
  alertsEnabled: true,
  alertTypes: [...alertTypes],
  delayThresholdMin: 5,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '06:30',
};

export function formFromCommute(c: CommuteDto): CommuteFormValues {
  return {
    name: c.name,
    home: { crs: c.homeCrs, name: c.homeName },
    work: { crs: c.workCrs, name: c.workName },
    outboundStart: c.outbound.start,
    outboundEnd: c.outbound.end,
    returnStart: c.return.start,
    returnEnd: c.return.end,
    activeDays: c.activeDays,
    operatorCodes: c.operatorCodes,
    isDefault: c.isDefault,
    alertsEnabled: c.alertSettings.enabled,
    alertTypes: c.alertSettings.types,
    delayThresholdMin: c.alertSettings.delayThresholdMin,
    quietHoursEnabled: c.alertSettings.quietHours !== null,
    quietStart: c.alertSettings.quietHours?.start ?? '22:00',
    quietEnd: c.alertSettings.quietHours?.end ?? '06:30',
  };
}

export type FormErrors = Partial<Record<string, string>>;

/** Builds the API payload, or field errors keyed by form field. */
export function toCommuteInput(v: CommuteFormValues): { ok: true; input: CommuteInput } | { ok: false; errors: FormErrors } {
  const candidate = {
    name: v.name,
    homeCrs: v.home?.crs ?? '',
    workCrs: v.work?.crs ?? '',
    outbound: { start: v.outboundStart, end: v.outboundEnd },
    return: { start: v.returnStart, end: v.returnEnd },
    activeDays: v.activeDays,
    operatorCodes: v.operatorCodes,
    isDefault: v.isDefault,
    alertSettings: {
      enabled: v.alertsEnabled,
      types: v.alertTypes,
      delayThresholdMin: v.delayThresholdMin,
      quietHours: v.quietHoursEnabled ? { start: v.quietStart, end: v.quietEnd } : null,
    },
  };
  const r = commuteInputSchema.safeParse(candidate);
  if (r.success) return { ok: true, input: r.data };
  const errors: FormErrors = {};
  for (const issue of r.error.issues) {
    const path = issue.path.join('.');
    const field =
      path === 'homeCrs' ? 'home'
      : path === 'workCrs' ? 'work'
      : path.startsWith('outbound') ? 'outbound'
      : path.startsWith('return') ? 'return'
      : path.startsWith('alertSettings.quietHours') ? 'quietHours'
      : path.startsWith('alertSettings.delayThresholdMin') ? 'delayThresholdMin'
      : path.split('.')[0]!;
    if (!errors[field]) {
      errors[field] =
        field === 'home' || field === 'work'
          ? v[field] === null ? 'Choose a station from the list' : issue.message
          : field === 'activeDays' ? 'Choose at least one day'
          : field === 'delayThresholdMin' ? 'Enter a number of minutes between 1 and 240'
          : issue.message;
    }
  }
  // The schema only checks this once every field is otherwise valid; say it straight away.
  if (v.home && v.work && v.home.crs === v.work.crs) errors.work = 'Home and work stations must differ';
  return { ok: false, errors };
}

export const WEEKDAYS = [
  { day: 1, short: 'Mon' },
  { day: 2, short: 'Tue' },
  { day: 3, short: 'Wed' },
  { day: 4, short: 'Thu' },
  { day: 5, short: 'Fri' },
  { day: 6, short: 'Sat' },
  { day: 7, short: 'Sun' },
] as const;

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  platform_change: 'Platform changes',
  cancellation: 'Cancellations',
  delay: 'Delays at or above my threshold',
  predicted_disruption: 'Predicted disruption (medium or high risk)',
};
