import { addDays, toLondon } from '@mct/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { CircleAlert, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { appNow } from '@/lib/clock';
import { delayLabel, hm } from '@/lib/format';
import {
  journeysQuery,
  operatorsQuery,
  suggestionsQuery,
  type ClaimStatus,
  type Eligibility,
  type Journey,
  type Suggestion,
  type TicketType,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { StationPicker } from '../commutes/station-picker';

const selectClass = 'border-input bg-background h-8 rounded-md border px-2 text-sm';

const TICKET_LABEL: Record<TicketType, string> = { single: 'Single', return: 'Return', season: 'Season' };
const CLAIM_LABEL: Record<ClaimStatus, string> = { none: 'Not claimed', claimed: 'Claimed', paid: 'Paid', rejected: 'Rejected' };

function TicketSelect({ value, onChange, id }: { value: TicketType; onChange: (t: TicketType) => void; id?: string }) {
  return (
    <select id={id} aria-label="Ticket type" className={selectClass} value={value} onChange={(e) => onChange(e.target.value as TicketType)}>
      {(Object.keys(TICKET_LABEL) as TicketType[]).map((t) => (
        <option key={t} value={t}>
          {TICKET_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

export function EligibilityBadge({ e }: { e: Eligibility }) {
  const map = {
    eligible: { variant: 'success' as const, text: e.percent !== null ? `Eligible · ${e.percent}%` : 'Eligible' },
    not_eligible: { variant: 'secondary' as const, text: 'Not eligible' },
    needs_arrival_time: { variant: 'warning' as const, text: 'Add arrival time' },
    no_scheme: { variant: 'outline' as const, text: 'No rules yet' },
  }[e.status];
  return <Badge variant={map.variant}>{map.text}</Badge>;
}

// ---------------------------------------------------------------------------

function SuggestionCard({ s, onEdit }: { s: Suggestion; onEdit: (s: Suggestion) => void }) {
  const qc = useQueryClient();
  const [ticketType, setTicketType] = useState<TicketType>('single');
  const confirm = useMutation({
    mutationFn: () => api('/api/journeys', { method: 'POST', json: { serviceId: s.serviceId, originCrs: s.originCrs, destCrs: s.destCrs, commuteId: s.commuteId, ticketType } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journeys'] }),
  });
  const delay = s.actualArr ? Math.round((Date.parse(s.actualArr) - Date.parse(s.schedArr)) / 60_000) : null;
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <p className="text-sm">
        Did you take the <strong>{hm(s.schedDep)}</strong> {s.originName} → {s.destName} ({s.operator})?
      </p>
      <p className="text-muted-foreground text-xs">
        {s.destCancelled
          ? "It didn't reach your station."
          : s.actualArr
            ? `Arrived ${hm(s.actualArr)}${delay ? ` (${delayLabel(delay)})` : ' on time'}.`
            : `Due ${hm(s.schedArr)}; no arrival time yet.`}{' '}
        {s.basis === 'usual' ? 'This is your usual train.' : "It's the first train in your window — change it if you took another."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <TicketSelect value={ticketType} onChange={setTicketType} />
        <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
          Yes, log it
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onEdit(s)}>
          I took a different train
        </Button>
      </div>
      {confirm.error && <p className="text-destructive text-sm">{errorMessage(confirm.error)}</p>}
    </div>
  );
}

function Suggestions({ onEdit }: { onEdit: (prefill: Partial<ManualValues>) => void }) {
  const today = toLondon(appNow()).date;
  const [date, setDate] = useState(today);
  const { data, isPending, error } = useQuery(suggestionsQuery(date));
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>Log your journeys</CardTitle>
        <CardDescription>Confirm the trains you actually took. Only journeys you log are checked for Delay Repay.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex gap-1">
          {[today, addDays(today, -1)].map((d, i) => (
            <Button key={d} size="sm" variant={date === d ? 'secondary' : 'ghost'} aria-pressed={date === d} onClick={() => setDate(d)}>
              {i === 0 ? 'Today' : 'Yesterday'}
            </Button>
          ))}
        </div>
        {isPending && <Skeleton className="h-20" />}
        {error && <p className="text-destructive text-sm">{errorMessage(error)}</p>}
        {data?.length === 0 && <p className="text-muted-foreground text-sm">Nothing to suggest for this day. You can add a journey by hand.</p>}
        {data?.map((s) => (
          <SuggestionCard
            key={s.serviceId}
            s={s}
            onEdit={() =>
              onEdit({ travelDate: s.travelDate, origin: { crs: s.originCrs, name: s.originName }, dest: { crs: s.destCrs, name: s.destName }, toc: s.toc })
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

interface ManualValues {
  travelDate: string;
  origin: { crs: string; name: string } | null;
  dest: { crs: string; name: string } | null;
  toc: string;
  schedDep: string;
  schedArr: string;
  actualArr: string;
  ticketType: TicketType;
}

function ManualJourneyDialog({ prefill, onClose }: { prefill: Partial<ManualValues> | null; onClose: () => void }) {
  const qc = useQueryClient();
  const operators = useQuery(operatorsQuery);
  const [v, setV] = useState<ManualValues>({
    travelDate: toLondon(appNow()).date,
    origin: null,
    dest: null,
    toc: '',
    schedDep: '',
    schedArr: '',
    actualArr: '',
    ticketType: 'single',
    ...prefill,
  });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api('/api/journeys', {
        method: 'POST',
        json: {
          travelDate: v.travelDate,
          originCrs: v.origin?.crs,
          destCrs: v.dest?.crs,
          toc: v.toc,
          schedDep: v.schedDep,
          schedArr: v.schedArr,
          actualArr: v.actualArr || null,
          ticketType: v.ticketType,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['journeys'] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!v.origin || !v.dest) return setError('Choose both stations from the list.');
    if (!v.toc) return setError('Choose the operator.');
    if (!v.schedDep || !v.schedArr) return setError('Enter the timetabled departure and arrival times.');
    setError(null);
    save.mutate();
  };
  const set = <K extends keyof ManualValues>(k: K, value: ManualValues[K]) => setV((p) => ({ ...p, [k]: value }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add a journey</DialogTitle>
          <DialogDescription>Enter the train you took, using the timetabled times. Times are UK time.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <Field label="Date" htmlFor="j-date">
            <Input id="j-date" type="date" value={v.travelDate} onChange={(e) => set('travelDate', e.target.value)} />
          </Field>
          <Field label="From" htmlFor="j-from">
            <StationPicker id="j-from" value={v.origin} onChange={(s) => set('origin', s)} />
          </Field>
          <Field label="To" htmlFor="j-to">
            <StationPicker id="j-to" value={v.dest} onChange={(s) => set('dest', s)} />
          </Field>
          <Field label="Operator" htmlFor="j-toc">
            <select id="j-toc" className={cn(selectClass, 'h-9')} value={v.toc} onChange={(e) => set('toc', e.target.value)}>
              <option value="">Choose…</option>
              {operators.data?.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Departs (timetable)" htmlFor="j-dep">
              <Input id="j-dep" type="time" value={v.schedDep} onChange={(e) => set('schedDep', e.target.value)} />
            </Field>
            <Field label="Arrives (timetable)" htmlFor="j-arr">
              <Input id="j-arr" type="time" value={v.schedArr} onChange={(e) => set('schedArr', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Actually arrived" htmlFor="j-act" hint="Leave blank if you don't know yet.">
              <Input id="j-act" type="time" value={v.actualArr} onChange={(e) => set('actualArr', e.target.value)} />
            </Field>
            <Field label="Ticket" htmlFor="j-ticket">
              <TicketSelect id="j-ticket" value={v.ticketType} onChange={(t) => set('ticketType', t)} />
            </Field>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Save journey
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArrivalDialog({ j, onClose }: { j: Journey; onClose: () => void }) {
  const qc = useQueryClient();
  const [time, setTime] = useState(j.actualArr ? hm(j.actualArr) : '');
  const save = useMutation({
    mutationFn: () => api(`/api/journeys/${j.id}`, { method: 'PATCH', json: { actualArr: time || null } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: journeysQuery.queryKey });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>When did you arrive?</DialogTitle>
          <DialogDescription>
            {hm(j.schedDep)} {j.originName} → {j.destName}, due {hm(j.schedArr)}. Enter the time you actually got to {j.destName}.
          </DialogDescription>
        </DialogHeader>
        <Field label="Arrival time" htmlFor="arr-time">
          <Input id="arr-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" />
        </Field>
        {save.error && <p className="text-destructive text-sm">{errorMessage(save.error)}</p>}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function JourneyActions({ j, onArrival }: { j: Journey; onArrival: (j: Journey) => void }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (claimStatus: ClaimStatus) => api(`/api/journeys/${j.id}`, { method: 'PATCH', json: { claimStatus } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: journeysQuery.queryKey }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/journeys/${j.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['journeys'] }),
  });
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select aria-label="Claim status" className={selectClass} value={j.claimStatus} onChange={(e) => update.mutate(e.target.value as ClaimStatus)}>
        {(Object.keys(CLAIM_LABEL) as ClaimStatus[]).map((c) => (
          <option key={c} value={c}>
            {CLAIM_LABEL[c]}
          </option>
        ))}
      </select>
      <Button variant="ghost" size="icon" aria-label="Edit arrival time" onClick={() => onArrival(j)}>
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Delete journey"
        disabled={remove.isPending}
        onClick={() => window.confirm('Delete this journey from your log?') && remove.mutate()}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function EligibilityCell({ j }: { j: Journey }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <EligibilityBadge e={j.eligibility} />
        {!j.eligibility.schemeVerified && j.eligibility.status !== 'no_scheme' && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs" title="These bands are placeholders that haven't been checked against the operator's terms.">
            <CircleAlert className="size-3" /> unverified rules
          </span>
        )}
      </div>
      <p className="text-muted-foreground max-w-64 text-xs">{j.eligibility.message}</p>
      {j.eligibility.status === 'eligible' && j.claimStatus === 'none' && (
        <p className="text-xs">
          {j.claimUrl ? (
            <a href={j.claimUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline">
              Claim from {j.operator} <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="text-muted-foreground">Claim on {j.operator}'s website.</span>
          )}
        </p>
      )}
    </div>
  );
}

function JourneySummary({ j }: { j: Journey }) {
  return (
    <div className="leading-tight">
      <div className="text-sm font-medium">
        {new Date(`${j.travelDate}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {hm(j.schedDep)}
      </div>
      <div className="text-muted-foreground text-xs">
        {j.originName} → {j.destName} · {j.operator} · {TICKET_LABEL[j.ticketType]}
      </div>
    </div>
  );
}

function ArrivalSummary({ j }: { j: Journey }) {
  const delay = delayLabel(j.arrivalDelayMin);
  return (
    <div className="text-sm leading-tight">
      <div>
        Due <span className="font-mono">{hm(j.schedArr)}</span>
      </div>
      <div className={cn('text-xs', (j.arrivalDelayMin ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground')}>
        {j.actualArr ? `Arrived ${hm(j.actualArr)}${delay ? ` · ${delay}` : ''}` : j.destCancelled ? 'Did not reach' : 'Not known'}
      </div>
    </div>
  );
}

const col = createColumnHelper<Journey>();

export function JourneysPage() {
  const { data, isPending, error } = useQuery(journeysQuery);
  const [manual, setManual] = useState<Partial<ManualValues> | null>(null);
  const [arrival, setArrival] = useState<Journey | null>(null);

  const columns = [
    col.accessor('travelDate', { header: 'Journey', cell: ({ row: { original: j } }) => <JourneySummary j={j} /> }),
    col.accessor('arrivalDelayMin', { header: 'Arrival', cell: ({ row: { original: j } }) => <ArrivalSummary j={j} /> }),
    col.accessor('eligibility', { header: 'Delay Repay', cell: ({ row: { original: j } }) => <EligibilityCell j={j} /> }),
    col.display({ id: 'actions', header: '', cell: ({ row: { original: j } }) => <JourneyActions j={j} onArrival={setArrival} /> }),
  ];
  const table = useReactTable({ data: data?.journeys ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: (j) => j.id });

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Journeys</h1>
        <Button onClick={() => setManual({})}>
          <Plus /> Add journey
        </Button>
      </div>

      <Suggestions onEdit={(prefill) => setManual(prefill)} />

      {isPending && <Skeleton className="h-40" />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Couldn't load your journeys: {errorMessage(error)}</AlertDescription>
        </Alert>
      )}
      {data && data.journeys.length === 0 && (
        <p className="text-muted-foreground text-sm">No journeys logged yet. Confirm one above or add one by hand.</p>
      )}
      {data && data.journeys.length > 0 && (
        <>
          {/* Phone: cards */}
          <ul className="grid gap-3 sm:hidden" aria-label="Logged journeys">
            {table.getRowModel().rows.map(({ original: j, id }) => (
              <li key={id} className="bg-card grid gap-2 rounded-xl border p-3">
                <JourneySummary j={j} />
                <ArrivalSummary j={j} />
                <EligibilityCell j={j} />
                <JourneyActions j={j} onArrival={setArrival} />
              </li>
            ))}
          </ul>
          {/* Wider screens: table */}
          <div className="bg-card hidden overflow-hidden rounded-xl border sm:block">
            <table className="w-full text-left">
              <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>
                    {hg.headers.map((h) => (
                      <th key={h.id} className="px-3 py-2 font-medium">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">{data.note}</p>
        </>
      )}

      {manual && <ManualJourneyDialog prefill={manual} onClose={() => setManual(null)} />}
      {arrival && <ArrivalDialog j={arrival} onClose={() => setArrival(null)} />}
    </div>
  );
}
