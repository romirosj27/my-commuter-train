import type { AlertLine } from '@mct/email';
import { formatLondonHm, riskReasons, type AlertDecision, type Leg, type RiskSummary } from '@mct/shared';

const hm = (iso: string | null) => (iso ? formatLondonHm(new Date(iso)) : null);

/** Turns an alert decision into a short, plain-English line for the email. */
export function describeAlert(d: AlertDecision, leg: Leg, ctx: { reason: string | null; risk?: RiskSummary | null }): AlertLine {
  const [kind, raw] = d.value.split(':') as [string, string];
  switch (d.type) {
    case 'platform_change': {
      const was = d.previous?.startsWith('plat:') ? d.previous.slice(5) : leg.from.platformBooked;
      const back = !leg.from.platformChanged;
      return {
        headline: back ? `Back to platform ${raw}` : `Now platform ${raw}`,
        detail: was && was !== raw ? `Was platform ${was} at ${leg.from.name}.` : null,
      };
    }
    case 'cancellation':
      if (raw === 'full') return { headline: 'Cancelled', detail: ctx.reason };
      if (raw === 'dest') return { headline: `Won't reach ${leg.to.name}`, detail: ['It terminates before your station.', ctx.reason].filter(Boolean).join(' ') };
      return { headline: 'Running again', detail: 'This train is no longer cancelled.' };
    case 'delay': {
      const exp = hm(leg.from.departure.expected);
      if (raw === 'recovered') {
        return { headline: 'Back near time', detail: exp ? `Now expected to leave ${leg.from.name} at ${exp}.` : null };
      }
      const arr = hm(leg.to.arrival.expected);
      const parts = [
        exp ? `Expected to leave ${leg.from.name} at ${exp}` : null,
        arr ? `arriving ${leg.to.name} at ${arr}` : null,
      ].filter(Boolean);
      return {
        headline: `${raw} min late`,
        detail: [parts.length ? `${parts.join(', ')}.` : null, ctx.reason].filter(Boolean).join(' ') || null,
      };
    }
    case 'predicted_disruption':
      if (raw === 'low') return { headline: 'Disruption risk has eased', detail: null };
      return {
        headline: `${raw === 'high' ? 'High' : 'Medium'} risk of disruption`,
        detail: (ctx.risk && riskReasons(ctx.risk).join(' ')) || null,
      };
    default:
      return { headline: kind, detail: null };
  }
}
