import type { CallView, LinkedService, ServiceDetail } from '@mct/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import { delayLabel, expectedText, hm, RISK_BADGE, RISK_LABEL, type ExpectedText } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BOARD_REFRESH_MS } from './board-page';
import { PlatformBadge } from './board-table';

export const serviceQuery = (id: string) =>
  queryOptions({
    queryKey: ['service', id],
    queryFn: () => api<ServiceDetail>(`/api/services/${id}`),
    refetchInterval: BOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
  });

const tone: Record<ExpectedText['tone'], string> = {
  ok: 'text-success',
  late: 'text-destructive font-medium',
  early: 'text-success',
  unknown: 'text-muted-foreground',
  cancelled: 'text-destructive font-medium',
};

function TimeCell({ label, t, cancelled }: { label: string; t: CallView['arrival']; cancelled: boolean }) {
  if (!t.scheduled) return null;
  const e = expectedText(t, cancelled);
  return (
    <div className="text-sm leading-tight">
      <span className="text-muted-foreground mr-1 text-xs">{label}</span>
      <span className="font-mono tabular-nums">{hm(t.scheduled)}</span>{' '}
      <span className={cn('text-xs', tone[e.tone])}>{e.tone === 'ok' && t.isActual ? 'On time' : e.text}</span>
    </div>
  );
}

function CallRow({ c, highlight, past }: { c: CallView; highlight: boolean; past: boolean }) {
  const pass = c.activity === 'pass';
  return (
    <li className={cn('relative grid grid-cols-[1.25rem_1fr_auto] gap-3 py-2', past && 'opacity-70')}>
      <div className="relative flex justify-center">
        <span className="bg-border absolute inset-y-[-0.5rem] w-0.5" aria-hidden />
        <span
          className={cn(
            'relative mt-1 size-3 rounded-full border-2',
            pass ? 'bg-background size-2 border-muted-foreground' : 'bg-background border-primary',
            highlight && 'bg-primary',
            c.isCancelled && 'border-destructive bg-destructive',
          )}
          aria-hidden
        />
      </div>
      <div className="min-w-0">
        <div className={cn('font-medium', pass && 'text-muted-foreground text-sm font-normal', c.isCancelled && 'line-through')}>
          {c.name}
          {pass && <span className="ml-1 text-xs">(passes)</span>}
          {highlight && <Badge variant="secondary" className="ml-2 align-middle">Your stop</Badge>}
        </div>
        {!pass && (
          <div className="flex flex-wrap gap-x-4">
            {c.activity !== 'origin' && <TimeCell label="arr" t={c.arrival} cancelled={c.isCancelled} />}
            {c.activity !== 'destination' && <TimeCell label="dep" t={c.departure} cancelled={c.isCancelled} />}
          </div>
        )}
        {c.isCancelled && <p className="text-destructive text-xs">Cancelled here{c.reason ? `: ${c.reason}` : ''}</p>}
      </div>
      {!pass && <PlatformBadge platform={c.platform} changed={c.platformChanged} />}
    </li>
  );
}

function LinkedCard({ title, s, verb, crs }: { title: string; s: LinkedService; verb: 'arrives' | 'departs'; crs: { from?: string; to?: string } }) {
  const t = s.at ? (verb === 'arrives' ? s.at.arrival : s.at.departure) : null;
  const delay = t ? delayLabel(t.delayMin) : null;
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-base">
          {s.origin} → {s.destination}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 px-4 text-sm">
        {s.isCancelled ? (
          <p className="text-destructive font-medium">This train is cancelled.</p>
        ) : t && s.at ? (
          <p>
            {verb === 'arrives' ? 'Due into' : 'Leaves'} {s.at.name} at <span className="font-mono">{hm(t.scheduled)}</span>
            {t.expected && delay ? (
              <>
                , {t.isActual ? (verb === 'arrives' ? 'arrived' : 'left') : 'expected'} <span className="font-mono">{hm(t.expected)}</span>{' '}
                <span className={cn((t.delayMin ?? 0) > 0 ? 'text-destructive font-medium' : 'text-success')}>({delay})</span>
              </>
            ) : (
              ' — on time'
            )}
          </p>
        ) : null}
        <Link to="/services/$serviceId" params={{ serviceId: s.serviceId }} search={crs} className="text-primary w-fit underline-offset-4 hover:underline">
          View this train
        </Link>
      </CardContent>
    </Card>
  );
}

export function ServicePage({ id, fromCrs, toCrs }: { id: string; fromCrs?: string; toCrs?: string }) {
  const { data, error, isPending, refetch, isFetching } = useQuery(serviceQuery(id));
  const [showPasses, setShowPasses] = useState(false);
  const router = useRouter();

  const back = (
    <Button variant="ghost" size="sm" className="w-fit" onClick={() => router.history.back()}>
      <ArrowLeft /> Back
    </Button>
  );
  if (isPending)
    return (
      <div className="grid gap-3">
        {back}
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    );
  if (error)
    return (
      <div className="grid gap-3">
        {back}
        <Alert variant="destructive">
          <AlertDescription>
            {(error as { status?: number }).status === 404 ? 'This train is no longer available.' : `Couldn't load this train: ${errorMessage(error)}`}
          </AlertDescription>
        </Alert>
      </div>
    );

  const calls = data.calls.filter((c) => showPasses || c.activity !== 'pass');
  const hasPasses = data.calls.some((c) => c.activity === 'pass');
  // The last call with an actual time: everything up to it has happened.
  const lastActual = data.calls.findLastIndex((c) => c.departure.isActual || c.arrival.isActual);
  const crs = { from: fromCrs, to: toCrs };

  return (
    <div className="grid gap-4">
      <div className="flex items-center">
        {back}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
          <RefreshCw className={cn(isFetching && 'animate-spin')} />
        </Button>
      </div>
      <div>
        <h1 className="text-xl font-semibold">
          {hm(data.calls[0]?.departure.scheduled)} {data.origin} to {data.destination}
        </h1>
        <p className="text-muted-foreground text-sm">
          {data.operator}
          {data.headcode ? ` · ${data.headcode}` : ''}
        </p>
      </div>

      {data.isCancelled && (
        <Alert variant="destructive">
          <AlertTitle>This train is cancelled</AlertTitle>
          {data.reason && <AlertDescription>{data.reason}</AlertDescription>}
        </Alert>
      )}
      {!data.isCancelled && data.reason && (
        <Alert>
          <AlertDescription>{data.reason}</AlertDescription>
        </Alert>
      )}
      {data.risk && data.risk.risk !== 'low' && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            <Badge variant={RISK_BADGE[data.risk.risk]}>{RISK_LABEL[data.risk.risk]}</Badge> of disruption
          </AlertTitle>
          <AlertDescription>
            {data.risk.reasons.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {data.formedBy && <LinkedCard title="Formed by the train arriving from" s={data.formedBy} verb="arrives" crs={crs} />}

      <Card className="py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">Calling points</CardTitle>
          {hasPasses && (
            <Label className="text-muted-foreground font-normal">
              <Switch checked={showPasses} onCheckedChange={setShowPasses} /> Show stations it passes
            </Label>
          )}
        </CardHeader>
        <CardContent className="px-4">
          <ol aria-label="Calling points">
            {calls.map((c) => {
              const i = data.calls.indexOf(c);
              return (
                <CallRow
                  key={`${c.tiploc}-${i}`}
                  c={c}
                  highlight={!!c.crs && (c.crs === fromCrs || c.crs === toCrs)}
                  past={i <= lastActual}
                />
              );
            })}
          </ol>
        </CardContent>
      </Card>

      {data.forms && <LinkedCard title="Then forms the train to" s={data.forms} verb="departs" crs={crs} />}
    </div>
  );
}
