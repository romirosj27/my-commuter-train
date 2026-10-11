import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { meQuery, schemesQuery, type Band, type Scheme } from '@/lib/queries';

const num = (v: string) => (v === '' ? NaN : Number(v));

function SchemeEditor({ scheme }: { scheme: Scheme }) {
  const qc = useQueryClient();
  const [s, setS] = useState(scheme);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api(`/api/delay-repay/schemes/${s.toc}`, {
        method: 'PUT',
        json: { name: s.name, bands: s.bands, claimUrl: s.claimUrl || null, notes: s.notes || null, verifiedOn: s.verifiedOn || null },
      }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: schemesQuery.queryKey });
      await qc.invalidateQueries({ queryKey: ['journeys'] });
    },
  });
  const setBand = (i: number, patch: Partial<Band>) => {
    setSaved(false);
    setS((p) => ({ ...p, bands: p.bands.map((b, k) => (k === i ? { ...b, ...patch } : b)) }));
  };
  const id = (f: string) => `${s.toc}-${f}`;
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {scheme.operator}
          {s.verifiedOn ? <Badge variant="success">Checked {s.verifiedOn}</Badge> : <Badge variant="warning">Unverified</Badge>}
        </CardTitle>
        <CardDescription>Bands are minutes late at the destination: from (inclusive) up to (exclusive).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Scheme name" htmlFor={id('name')}>
          <Input id={id('name')} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </Field>
        <div className="grid gap-2">
          <div className="text-muted-foreground grid grid-cols-[repeat(4,1fr)_auto] gap-2 text-xs">
            <span>From (min)</span>
            <span>Up to (min)</span>
            <span>Single %</span>
            <span>Return %</span>
            <span className="w-9" />
          </div>
          {s.bands.map((b, i) => (
            <div key={i} className="grid grid-cols-[repeat(4,1fr)_auto] gap-2">
              <Input aria-label={`Band ${i + 1} from`} type="number" value={b.minMinutes} onChange={(e) => setBand(i, { minMinutes: num(e.target.value) })} />
              <Input
                aria-label={`Band ${i + 1} up to`}
                type="number"
                placeholder="no limit"
                value={b.maxMinutes ?? ''}
                onChange={(e) => setBand(i, { maxMinutes: e.target.value === '' ? null : num(e.target.value) })}
              />
              <Input aria-label={`Band ${i + 1} single %`} type="number" value={b.singlePct} onChange={(e) => setBand(i, { singlePct: num(e.target.value) })} />
              <Input aria-label={`Band ${i + 1} return %`} type="number" value={b.returnPct} onChange={(e) => setBand(i, { returnPct: num(e.target.value) })} />
              <Button variant="ghost" size="icon" aria-label={`Remove band ${i + 1}`} onClick={() => setS({ ...s, bands: s.bands.filter((_, k) => k !== i) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => {
              const last = s.bands.at(-1);
              const start = last?.maxMinutes ?? (last ? last.minMinutes + 30 : 15);
              setS({ ...s, bands: [...s.bands, { minMinutes: start, maxMinutes: null, singlePct: 100, returnPct: 50 }] });
            }}
          >
            <Plus /> Add band
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Claim page (https://…)" htmlFor={id('url')}>
            <Input id={id('url')} type="url" value={s.claimUrl ?? ''} onChange={(e) => setS({ ...s, claimUrl: e.target.value })} />
          </Field>
          <Field label="Checked against operator's terms on" htmlFor={id('verified')} hint="Leave blank while these are placeholders.">
            <Input id={id('verified')} type="date" value={s.verifiedOn ?? ''} onChange={(e) => setS({ ...s, verifiedOn: e.target.value || null })} />
          </Field>
        </div>
        <Field label="Notes" htmlFor={id('notes')}>
          <Input id={id('notes')} value={s.notes ?? ''} onChange={(e) => setS({ ...s, notes: e.target.value })} />
        </Field>
        {save.error && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(save.error)}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save {scheme.operator}
          </Button>
          {saved && <span className="text-success text-sm">Saved</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function SchemesAdminPage() {
  const me = useQuery(meQuery);
  const { data, isPending, error } = useQuery(schemesQuery);
  if (me.data && !me.data.isAdmin) {
    return (
      <Alert>
        <AlertDescription>Only administrators can edit Delay Repay rules.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Delay Repay rules</h1>
      <p className="text-muted-foreground text-sm">
        These bands decide which logged journeys look eligible. Mark a scheme as checked only after comparing it with the operator's current terms.
      </p>
      {isPending && <Skeleton className="h-64" />}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      )}
      {data?.schemes.map((s) => <SchemeEditor key={s.toc} scheme={s} />)}
    </div>
  );
}
